package rbac

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// CanAccess checks whether a role has access to a tool.
func (s *Service) CanAccess(ctx context.Context, roleID, toolID uuid.UUID) (bool, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM role_tool_grants
		WHERE role_id = $1 AND tool_id = $2
	`, roleID, toolID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("rbac check: %w", err)
	}
	return count > 0, nil
}

// ToolsForRole returns all tool IDs accessible to a role.
func (s *Service) ToolsForRole(ctx context.Context, roleID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT tool_id FROM role_tool_grants WHERE role_id = $1
	`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// GrantAccess grants a role access to a tool.
func (s *Service) GrantAccess(ctx context.Context, roleID, toolID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO role_tool_grants (role_id, tool_id) VALUES ($1, $2)
		ON CONFLICT DO NOTHING
	`, roleID, toolID)
	return err
}

// RevokeAccess revokes a role's access to a tool.
func (s *Service) RevokeAccess(ctx context.Context, roleID, toolID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM role_tool_grants WHERE role_id = $1 AND tool_id = $2
	`, roleID, toolID)
	return err
}

// SetRoleTools replaces all tool grants for a role with the given list.
func (s *Service) SetRoleTools(ctx context.Context, roleID uuid.UUID, toolIDs []uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM role_tool_grants WHERE role_id = $1`, roleID); err != nil {
		return err
	}
	for _, toolID := range toolIDs {
		if _, err := tx.Exec(ctx, `INSERT INTO role_tool_grants (role_id, tool_id) VALUES ($1, $2)`, roleID, toolID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
