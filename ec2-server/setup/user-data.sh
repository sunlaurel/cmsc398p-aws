#!/bin/bash
# EC2 user data for Amazon Linux 2023.
# Paste this into "Advanced details -> User data" when launching the instance.
# Set REPO_URL to your public GitHub repo containing this project.
set -euxo pipefail

REPO_URL="https://github.com/<your-username>/cmsc398p-aws.git"

# Node.js 20 + git
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs git

# Fetch and build the server as ec2-user
sudo -u ec2-user git clone "$REPO_URL" /home/ec2-user/app
cd /home/ec2-user/app/ec2-server
sudo -u ec2-user npm ci
sudo -u ec2-user npm run build

# Run as a systemd service on port 80
cp setup/pinterest.service /etc/systemd/system/pinterest.service
systemctl daemon-reload
systemctl enable --now pinterest
