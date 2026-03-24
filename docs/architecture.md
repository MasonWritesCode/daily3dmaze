# Architecture Notes

## Project Goal

`daily3dmaze` is intended to be a portfolio-quality open-source fullstack application, not just a rendering demo.

The maze experience is the hook. The broader platform is the showcase:
- frontend application architecture
- backend API design
- relational data modeling
- leaderboard and validation logic
- background jobs
- admin and moderation tooling

## Initial Direction

The project will begin as a monorepo with two primary applications:

- `web/`: a Next.js app for the public site, game UI, leaderboards, profiles, and future admin surfaces
- `api/`: a Go service for application logic, persistence, validation, and worker processes

Supporting infrastructure is expected to include:
- Postgres

## Development Approach

This project will be developed slowly and incrementally.

Early commits should prefer:
- small scope
- clear intent
- minimal scaffolding

Infrastructure automation, advanced deployment setup, and deeper platform concerns should be added only when the application grows enough to justify them.
