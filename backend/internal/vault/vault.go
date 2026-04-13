package vault

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/openproxy/openproxy/internal/config"
)

type Service struct {
	cfg  *config.Config
	pool *pgxpool.Pool
}

func NewService(cfg *config.Config, pool *pgxpool.Pool) *Service {
	return &Service{cfg: cfg, pool: pool}
}

// ── Tool-level credentials ────────────────────────────────────────────────────

func (s *Service) SetCredential(ctx context.Context, toolID uuid.UUID, key, value string) error {
	ct, nonce, err := s.encrypt([]byte(value))
	if err != nil {
		return fmt.Errorf("encrypt: %w", err)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO tool_credentials (tool_id, key, ciphertext, nonce)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (tool_id, key) DO UPDATE
		SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, updated_at = NOW()
	`, toolID, key, ct, nonce)
	return err
}

func (s *Service) GetCredentials(ctx context.Context, toolID uuid.UUID) (map[string]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT key, ciphertext, nonce FROM tool_credentials WHERE tool_id = $1`, toolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]string{}
	for rows.Next() {
		var key string
		var ct, nonce []byte
		if err := rows.Scan(&key, &ct, &nonce); err != nil {
			return nil, err
		}
		plain, err := s.decrypt(ct, nonce)
		if err != nil {
			return nil, fmt.Errorf("decrypt %s: %w", key, err)
		}
		result[key] = string(plain)
	}
	return result, rows.Err()
}

func (s *Service) DeleteCredentials(ctx context.Context, toolID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM tool_credentials WHERE tool_id = $1`, toolID)
	return err
}

// ── User-level credentials ────────────────────────────────────────────────────

func (s *Service) SetUserCredential(ctx context.Context, userID, toolID uuid.UUID, key, value string) error {
	ct, nonce, err := s.encrypt([]byte(value))
	if err != nil {
		return fmt.Errorf("encrypt: %w", err)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO user_tool_credentials (user_id, tool_id, key, ciphertext, nonce)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, tool_id, key) DO UPDATE
		SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, updated_at = NOW()
	`, userID, toolID, key, ct, nonce)
	return err
}

func (s *Service) GetUserCredentials(ctx context.Context, userID, toolID uuid.UUID) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT key, ciphertext, nonce FROM user_tool_credentials
		WHERE user_id = $1 AND tool_id = $2
	`, userID, toolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]string{}
	for rows.Next() {
		var key string
		var ct, nonce []byte
		if err := rows.Scan(&key, &ct, &nonce); err != nil {
			return nil, err
		}
		plain, err := s.decrypt(ct, nonce)
		if err != nil {
			return nil, fmt.Errorf("decrypt %s: %w", key, err)
		}
		result[key] = string(plain)
	}
	return result, rows.Err()
}

func (s *Service) DeleteUserCredentials(ctx context.Context, userID, toolID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM user_tool_credentials WHERE user_id = $1 AND tool_id = $2
	`, userID, toolID)
	return err
}

// ResolveCredentials returns effective credentials: user-level overrides tool-level key-by-key.
// This is what the proxy calls — it always gets the right creds for this specific user.
func (s *Service) ResolveCredentials(ctx context.Context, userID, toolID uuid.UUID) (map[string]string, error) {
	toolCreds, err := s.GetCredentials(ctx, toolID)
	if err != nil {
		return nil, fmt.Errorf("tool creds: %w", err)
	}
	userCreds, err := s.GetUserCredentials(ctx, userID, toolID)
	if err != nil {
		return nil, fmt.Errorf("user creds: %w", err)
	}
	// Merge: start with tool defaults, overlay user overrides
	merged := make(map[string]string, len(toolCreds)+len(userCreds))
	for k, v := range toolCreds {
		merged[k] = v
	}
	for k, v := range userCreds {
		merged[k] = v
	}
	return merged, nil
}

// ── Crypto ────────────────────────────────────────────────────────────────────

func (s *Service) encrypt(plaintext []byte) (ciphertext, nonce []byte, err error) {
	block, err := aes.NewCipher(s.cfg.MasterKey)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return gcm.Seal(nil, nonce, plaintext, nil), nonce, nil
}

func (s *Service) decrypt(ciphertext, nonce []byte) ([]byte, error) {
	block, err := aes.NewCipher(s.cfg.MasterKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}
