package config

import (
        "encoding/hex"
        "log"
        "os"
        "strconv"
)

type Config struct {
        DatabaseURL   string
        JWTSecret     []byte
        JWTExpiryHours int
        MasterKey     []byte // 32-byte AES-256 key
        Port          string
        FrontendURL   string

        // WireGuard
        WGInterface      string
        WGServerIP       string
        WGSubnet         string
        WGListenPort     int
        WGPrivateKey     string
        WGPublicEndpoint string // Public IP/hostname:port peers use to reach this server

        // Proxy
        ProxyBaseDomain string

        // Initial admin
        AdminEmail    string
        AdminPassword string
}

func Load() *Config {
        cfg := &Config{
                DatabaseURL:     env("DATABASE_URL", "postgres://openportal:changeme@localhost:5432/openproxy?sslmode=disable"),
                Port:            env("PORT", "8080"),
                FrontendURL:     env("FRONTEND_URL", "http://localhost:5173"),
                WGInterface:     env("WG_INTERFACE", "wg0"),
                WGServerIP:      env("WG_SERVER_IP", "10.10.0.1"),
                WGSubnet:        env("WG_SUBNET", "10.10.0.0/24"),
                WGListenPort:    envInt("WG_LISTEN_PORT", 51820),
                WGPrivateKey:     env("WG_PRIVATE_KEY", ""),
                WGPublicEndpoint: env("WG_PUBLIC_ENDPOINT", ""),
                ProxyBaseDomain: env("PROXY_BASE_DOMAIN", "localhost"),
                AdminEmail:      env("ADMIN_EMAIL", "admin@example.com"),
                AdminPassword:   env("ADMIN_PASSWORD", ""),
                JWTExpiryHours:  envInt("JWT_EXPIRY_HOURS", 8),
        }

        // JWT secret
        jwtSecret := env("JWT_SECRET", "")
        if jwtSecret == "" {
                log.Fatal("JWT_SECRET must be set (generate with: openssl rand -base64 48)")
        }
        cfg.JWTSecret = []byte(jwtSecret)

        // Admin password
        if cfg.AdminPassword == "" {
                log.Fatal("ADMIN_PASSWORD must be set")
        }

        // Master key (hex-encoded 32 bytes)
        masterKeyHex := env("MASTER_KEY", "")
        if masterKeyHex == "" {
                log.Fatal("MASTER_KEY must be set")
        }
        key, err := hex.DecodeString(masterKeyHex)
        if err != nil || len(key) != 32 {
                log.Fatal("MASTER_KEY must be a 64-char hex string (32 bytes)")
        }
        cfg.MasterKey = key

        return cfg
}

func env(key, fallback string) string {
        if v := os.Getenv(key); v != "" {
                return v
        }
        return fallback
}

func envInt(key string, fallback int) int {
        if v := os.Getenv(key); v != "" {
                if n, err := strconv.Atoi(v); err == nil {
                        return n
                }
        }
        return fallback
}
