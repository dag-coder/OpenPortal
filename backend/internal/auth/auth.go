package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/openproxy/openproxy/internal/config"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

// ErrMFARequired is returned by Login when the user has TOTP enabled.
// The caller receives a short-lived pending token instead of a full session.
var ErrMFARequired = errors.New("mfa required")

type Claims struct {
	UserID     string `json:"sub"`
	Email      string `json:"email"`
	IsAdmin    bool   `json:"is_admin"`
	RoleID     string `json:"role_id"`
	MFAPending bool   `json:"mfa_pending,omitempty"`
	jwt.RegisteredClaims
}

type Service struct {
	cfg  *config.Config
	pool *pgxpool.Pool
}

func NewService(cfg *config.Config, pool *pgxpool.Pool) *Service {
	return &Service{cfg: cfg, pool: pool}
}

type User struct {
	ID           uuid.UUID
	Email        string
	Name         string
	PasswordHash string
	RoleID       *uuid.UUID
	IsAdmin      bool
	MFAEnabled   bool
	Status       string
}

// Login validates credentials. If the user has TOTP enabled it returns
// ErrMFARequired together with a 5-minute pending token; the caller must
// then present that token plus a valid TOTP code to VerifyTOTPLogin.
func (s *Service) Login(ctx context.Context, email, password string) (string, *User, error) {
	var u User
	var roleID *string
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, name, password_hash, role_id, is_admin, mfa_enabled, status
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &roleID, &u.IsAdmin, &u.MFAEnabled, &u.Status)
	if err != nil {
		return "", nil, errors.New("invalid credentials")
	}
	if u.Status == "suspended" {
		return "", nil, errors.New("account suspended")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return "", nil, errors.New("invalid credentials")
	}

	roleIDStr := ""
	if roleID != nil {
		roleIDStr = *roleID
	}

	if u.MFAEnabled {
		// Issue a short-lived pending token — not a usable session.
		pending, err := s.issuePendingToken(u.ID.String(), u.Email, u.IsAdmin, roleIDStr)
		if err != nil {
			return "", nil, fmt.Errorf("issue pending token: %w", err)
		}
		return pending, &u, ErrMFARequired
	}

	_, _ = s.pool.Exec(ctx, `UPDATE users SET last_seen_at = NOW() WHERE id = $1`, u.ID)

	token, err := s.issueToken(u.ID.String(), u.Email, u.IsAdmin, roleIDStr)
	if err != nil {
		return "", nil, fmt.Errorf("issue token: %w", err)
	}
	return token, &u, nil
}

// VerifyTOTPLogin validates a pending token + TOTP code and issues a full session.
func (s *Service) VerifyTOTPLogin(ctx context.Context, pendingToken, code string) (string, *User, error) {
	claims, err := s.Validate(pendingToken)
	if err != nil {
		return "", nil, errors.New("invalid session")
	}
	if !claims.MFAPending {
		return "", nil, errors.New("not a pending token")
	}

	var u User
	var roleID *string
	var secret string
	err = s.pool.QueryRow(ctx, `
		SELECT id, email, name, role_id, is_admin, mfa_enabled, mfa_secret, status
		FROM users WHERE id = $1
	`, claims.UserID).Scan(&u.ID, &u.Email, &u.Name, &roleID, &u.IsAdmin, &u.MFAEnabled, &secret, &u.Status)
	if err != nil {
		return "", nil, errors.New("user not found")
	}
	if !u.MFAEnabled || secret == "" {
		return "", nil, errors.New("MFA not configured")
	}
	if !totp.Validate(code, secret) {
		return "", nil, errors.New("invalid code")
	}

	roleIDStr := ""
	if roleID != nil {
		roleIDStr = *roleID
	}

	_, _ = s.pool.Exec(ctx, `UPDATE users SET last_seen_at = NOW() WHERE id = $1`, u.ID)

	token, err := s.issueToken(u.ID.String(), u.Email, u.IsAdmin, roleIDStr)
	if err != nil {
		return "", nil, fmt.Errorf("issue token: %w", err)
	}
	return token, &u, nil
}

// SetupTOTP generates a new TOTP secret for the user and stores it (not yet enabled).
// Returns the provisioning URI to show as a QR code, and the raw secret.
func (s *Service) SetupTOTP(ctx context.Context, userID string) (provisioningURI, secret string, err error) {
	var email string
	if err = s.pool.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
		return "", "", errors.New("user not found")
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "OpenPortal",
		AccountName: email,
	})
	if err != nil {
		return "", "", fmt.Errorf("generate key: %w", err)
	}
	// Store the secret but don't enable MFA yet.
	_, err = s.pool.Exec(ctx, `UPDATE users SET mfa_secret = $1 WHERE id = $2`, key.Secret(), userID)
	if err != nil {
		return "", "", fmt.Errorf("store secret: %w", err)
	}
	return key.URL(), key.Secret(), nil
}

// EnableTOTP verifies a TOTP code against the stored (pending) secret and
// turns MFA on for the user.
func (s *Service) EnableTOTP(ctx context.Context, userID, code string) error {
	var secret string
	if err := s.pool.QueryRow(ctx, `SELECT mfa_secret FROM users WHERE id = $1`, userID).Scan(&secret); err != nil || secret == "" {
		return errors.New("no pending TOTP setup found; call setup first")
	}
	if !totp.Validate(code, secret) {
		return errors.New("invalid code — make sure your authenticator clock is accurate")
	}
	_, err := s.pool.Exec(ctx, `UPDATE users SET mfa_enabled = TRUE WHERE id = $1`, userID)
	return err
}

// DisableTOTP disables MFA for the user.
func (s *Service) DisableTOTP(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = $1`, userID)
	return err
}

// issueToken creates a full, long-lived session JWT.
func (s *Service) issueToken(userID, email string, isAdmin bool, roleID string) (string, error) {
	claims := &Claims{
		UserID:  userID,
		Email:   email,
		IsAdmin: isAdmin,
		RoleID:  roleID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(s.cfg.JWTExpiryHours) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "openportal",
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.cfg.JWTSecret)
}

// issuePendingToken creates a 5-minute token that only satisfies TOTP verification.
func (s *Service) issuePendingToken(userID, email string, isAdmin bool, roleID string) (string, error) {
	claims := &Claims{
		UserID:     userID,
		Email:      email,
		IsAdmin:    isAdmin,
		RoleID:     roleID,
		MFAPending: true,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "openportal",
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.cfg.JWTSecret)
}

func (s *Service) Validate(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.cfg.JWTSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
