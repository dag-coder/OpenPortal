package main

import (
        "context"
        "log"
        "os"
        "os/signal"
        "syscall"
        "time"

        "github.com/joho/godotenv"
        "github.com/openproxy/openproxy/internal/api"
        "github.com/openproxy/openproxy/internal/config"
        "github.com/openproxy/openproxy/internal/db"
        "github.com/openproxy/openproxy/internal/health"
        "github.com/openproxy/openproxy/internal/wireguard"
)

func main() {
        // Load .env if present (dev mode)
        _ = godotenv.Load()

        cfg := config.Load()

        // Connect to database
        pool, err := db.Connect(cfg.DatabaseURL)
        if err != nil {
                log.Fatalf("failed to connect to database: %v", err)
        }
        defer pool.Close()

        // Run migrations
        if err := db.Migrate(pool, "migrations"); err != nil {
                log.Fatalf("migration failed: %v", err)
        }

        // Seed initial admin if not exists
        if err := db.SeedAdmin(context.Background(), pool, cfg); err != nil {
                log.Printf("warn: seed admin: %v", err)
        }

        // Initialise WireGuard keys (generate + persist if not already set)
        wgSvc := wireguard.NewService(cfg, pool)
        if err := wgSvc.InitKeys(context.Background()); err != nil {
                log.Fatalf("wireguard init: %v", err)
        }

        // Build and start HTTP server
        srv := api.NewServer(cfg, pool)

        go func() {
                log.Printf("OpenPortal listening on :%s", cfg.Port)
                if err := srv.ListenAndServe(); err != nil {
                        log.Printf("server stopped: %v", err)
                }
        }()

        // Start background tool health prober
        healthCtx, healthCancel := context.WithCancel(context.Background())
        defer healthCancel()
        go health.Run(healthCtx, pool)

        // Start background WireGuard peer status sync (every 30s)
        go func() {
                ticker := time.NewTicker(30 * time.Second)
                defer ticker.Stop()
                // Run once immediately so the UI reflects status without waiting 30s
                _ = wgSvc.SyncPeerStatus(healthCtx)
                for {
                        select {
                        case <-healthCtx.Done():
                                return
                        case <-ticker.C:
                                _ = wgSvc.SyncPeerStatus(healthCtx)
                        }
                }
        }()

        // Graceful shutdown
        quit := make(chan os.Signal, 1)
        signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
        <-quit

        healthCancel()

        ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
        defer cancel()
        if err := srv.Shutdown(ctx); err != nil {
                log.Fatalf("server shutdown failed: %v", err)
        }
        log.Println("OpenPortal shut down cleanly")
}
