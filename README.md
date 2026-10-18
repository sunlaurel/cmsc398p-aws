# cmsc398p-aws: Pinterest infinite scroll on AWS

A small-scale version of Pinterest's core experience: a profile section plus an endless masonry feed of random images, built on AWS.

## Architecture

```
IAM  (roles & policies governing every service below)
 │
 ▼
S3 static website  (frontend/: index.html, styles.css, app.js, config.js)
 ├──▶ API Gateway (HTTP API, GET /images) ──▶ EC2 (Express, port 80) ──▶ picsum.photos
 └──▶ Lambda Function URL ──▶ Lambda (profile) ──▶ DynamoDB "PinterestUsers"
```

| Piece | Folder | What it does |
|---|---|---|
| Web interface | [frontend/](frontend/) | Profile form at the top (create/update/load by username); masonry feed that uses `IntersectionObserver` to request more images from API Gateway as you near the bottom |
| Image service | [ec2-server/](ec2-server/) | `GET /images?count=N` fetches a random page from the Picsum API and returns pins with random heights |
| Profile function | [lambda/profile/](lambda/profile/) | `GET ?userId=` reads a profile; `PUT` creates/updates it (`createdAt` / `updatedAt` tracked) |

Everything is TypeScript.

## Local development

```bash
# 1. Image server on :3000
cd ec2-server && npm install && npm run dev

# 2. Frontend
cd frontend && npm install && npm run build
cp config.example.js config.js   # set imagesApiUrl to http://localhost:3000
npm run serve                     # http://localhost:5173
```

The profile section needs the deployed Lambda Function URL, since it talks to DynamoDB.

## Deploying

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the step-by-step AWS Console guide (DynamoDB → IAM → Lambda → EC2 → API Gateway → S3) and teardown checklist.
