package health

import (
	"context"
	"crypto/tls"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	probeInterval = 30 * time.Second
	probeTimeout  = 10 * time.Second
)

var client = &http.Client{
	Timeout: probeTimeout,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return http.ErrUseLastResponse
		}
		return nil
	},
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
}

type toolRow struct {
	id  uuid.UUID
	url string
}

func probe(url string) string {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "offline"
	}
	req.Header.Set("User-Agent", "OpenPortal-HealthCheck/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "offline"
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode >= 500:
		return "degraded"
	default:
		return "online"
	}
}

func Run(ctx context.Context, pool *pgxpool.Pool) {
	tick := time.NewTicker(probeInterval)
	defer tick.Stop()

	runOnce(ctx, pool)

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			runOnce(ctx, pool)
		}
	}
}

func runOnce(ctx context.Context, pool *pgxpool.Pool) {
	rows, err := pool.Query(ctx, `SELECT id, url FROM tools`)
	if err != nil {
		log.Printf("health: query tools: %v", err)
		return
	}
	var tools []toolRow
	for rows.Next() {
		var t toolRow
		if err := rows.Scan(&t.id, &t.url); err == nil {
			tools = append(tools, t)
		}
	}
	rows.Close()

	for _, t := range tools {
		status := probe(t.url)
		_, err := pool.Exec(ctx,
			`UPDATE tools SET status = $1 WHERE id = $2`,
			status, t.id,
		)
		if err != nil {
			log.Printf("health: update status for %s: %v", t.id, err)
		}
	}

	log.Printf("health: probed %d tool(s)", len(tools))
}
