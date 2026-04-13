#!/bin/bash
set -e

# Rebuild and start backend in background
cd backend
go build -o openproxy-server ./cmd/server
./openproxy-server &
echo "Backend started (PID $!)"
cd ..

# Start frontend (this will serve on port 5000)
cd frontend
npm run dev
