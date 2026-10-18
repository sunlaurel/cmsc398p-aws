# Deployment guide (AWS Console)

Deploy in this order. Each step produces something the next one needs: a table name, a Lambda URL, an EC2 DNS name, an API URL.

Use a single region for everything (e.g. `us-east-1`). Do this as an **IAM user** with admin or the needed permissions, not as the root account.

---

## 0. Prerequisites

- Node.js 20+ and npm locally
- This repo pushed to a **public** GitHub repo (the EC2 instance clones it)
- Build the deployables:

```bash
cd lambda/profile && npm install && npm run package   # -> lambda/profile/function.zip
cd ../../frontend && npm install && npm run build      # -> frontend/app.js
```

---

## 1. DynamoDB: user table

1. **DynamoDB → Tables → Create table**
2. Table name: `PinterestUsers`
3. Partition key: `userId` (String)
4. Table settings: **Customize** → Capacity mode **On-demand** (or keep defaults)
5. Create. Copy the **table ARN** from *General information* (you need it for IAM).

---

## 2. IAM: role for the Lambda

1. **IAM → Roles → Create role**
2. Trusted entity: **AWS service → Lambda**
3. Attach managed policy: `AWSLambdaBasicExecutionRole` (CloudWatch logs)
4. Name: `pinterest-profile-lambda-role` → Create
5. Open the role → **Add permissions → Create inline policy → JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/PinterestUsers"
    }
  ]
}
```

6. Name it `PinterestUsersTableAccess` → Create.

This is least privilege: the function can read and write only this one table.

---

## 3. Lambda: profile function

1. **Lambda → Create function → Author from scratch**
   - Name: `pinterest-profile`
   - Runtime: **Node.js 20.x**
   - Architecture: x86_64
   - Execution role: **Use an existing role** → `pinterest-profile-lambda-role`
2. **Code → Upload from → .zip file** → choose `lambda/profile/function.zip`
3. **Runtime settings → Edit** → Handler: `index.handler`
4. **Configuration → Environment variables** → add `TABLE_NAME` = `PinterestUsers`
5. **Configuration → Function URL → Create function URL**
   - Auth type: **NONE**
   - Expand **Additional settings → Configure cross-origin resource sharing (CORS)** ✅
     - Allow origin: `*` (or your S3 website URL once you have it)
     - Allow methods: `GET`, `PUT`
     - Allow headers: `content-type`
   - Save. The console adds the public resource-based policy automatically.
6. Copy the **Function URL** (e.g. `https://xxxx.lambda-url.us-east-1.on.aws/`).

**Test it:**

```bash
FN=https://xxxx.lambda-url.us-east-1.on.aws/
curl -X PUT "$FN" -H 'content-type: application/json' \
  -d '{"userId":"test_user","displayName":"Test","email":"t@example.com","bio":"hi","interests":["art"]}'
curl "$FN?userId=test_user"
```

The item should appear under **DynamoDB → Explore items → PinterestUsers**.

---

## 4. EC2: image server

1. **EC2 → Launch instance**
   - Name: `pinterest-image-server`
   - AMI: **Amazon Linux 2023**
   - Instance type: `t2.micro` / `t3.micro` (free tier)
   - Key pair: create or choose one (for SSH debugging)
   - Network settings → **Create security group**:
     - SSH (22) from **My IP**
     - HTTP (80) from **Anywhere** (API Gateway calls it over the public internet)
   - **Advanced details → User data**: paste `ec2-server/setup/user-data.sh` with `REPO_URL` set to your GitHub repo
2. Launch. Wait about 2–3 minutes for user data to finish.
3. Copy the instance's **Public IPv4 DNS** (e.g. `ec2-3-91-0-1.compute-1.amazonaws.com`).

**Test it:**

```bash
curl http://<public-dns>/health
curl "http://<public-dns>/images?count=3"
```

**Troubleshooting:** SSH in and run `sudo cat /var/log/cloud-init-output.log` or `sudo journalctl -u pinterest -f`.

> The public DNS changes if you **stop/start** the instance. Either attach an **Elastic IP** (EC2 → Elastic IPs → Allocate → Associate) or update the API Gateway integration URL after each restart.

---

## 5. API Gateway: front door for EC2

1. **API Gateway → Create API → HTTP API → Build**
2. **Add integration → HTTP**
   - Method: `GET`
   - URL endpoint: `http://<ec2-public-dns>/images`
3. API name: `pinterest-images-api` → Next
4. Configure routes: Method `GET`, Resource path `/images`, Integration target: the HTTP integration above → Next
5. Stage: `$default` with **Auto-deploy** on → Next → Create
6. Left menu **CORS → Configure**:
   - Access-Control-Allow-Origin: `*` (or your S3 website URL)
   - Access-Control-Allow-Methods: `GET`
   - Access-Control-Allow-Headers: `content-type`
   - Save
7. Copy the **Invoke URL** (e.g. `https://abc123.execute-api.us-east-1.amazonaws.com`).

**Test it:**

```bash
curl "https://abc123.execute-api.us-east-1.amazonaws.com/images?count=3"
```

---

## 6. S3: static website

1. **S3 → Create bucket**
   - Name: globally unique, e.g. `pinboard-<yourname>-cmsc398p`
   - **Uncheck "Block all public access"** and acknowledge the warning
2. Bucket → **Properties → Static website hosting → Enable**
   - Index document: `index.html` → Save
3. Bucket → **Permissions → Bucket policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForWebsite",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<bucket-name>/*"
    }
  ]
}
```

4. Create the site config locally:

```bash
cd frontend
cp config.example.js config.js
# edit config.js: imagesApiUrl = API Gateway invoke URL, profileFunctionUrl = Lambda Function URL
```

5. **Upload** these 4 files to the bucket root: `index.html`, `styles.css`, `app.js`, `config.js`
   (or `aws s3 sync . s3://<bucket-name> --exclude "*" --include index.html --include styles.css --include app.js --include config.js`)
6. Open the **Bucket website endpoint** from Properties → Static website hosting
   (`http://<bucket>.s3-website-<region>.amazonaws.com`).

*Optional hardening:* now that you know the website URL, replace the `*` CORS origins in steps 3 and 5 with it.

---

## 7. End-to-end check

- [ ] Page loads from the S3 website URL and pins appear right away
- [ ] Scrolling to the bottom loads more pins with a spinner (DevTools → Network shows repeated `GET /images` calls to API Gateway)
- [ ] Enter a username, fill in the fields, **Save profile** → "Profile saved!" and the item appears in DynamoDB
- [ ] Reload the page → profile auto-loads (last username is remembered); change a field, save again → `updatedAt` changes, `createdAt` doesn't

---

## 8. Teardown (avoid charges)

- EC2: **Terminate** the instance (and release the Elastic IP if you made one; unattached EIPs are billed)
- API Gateway: delete `pinterest-images-api`
- Lambda: delete `pinterest-profile` (and its CloudWatch log group)
- DynamoDB: delete `PinterestUsers`
- S3: empty the bucket and delete it
- IAM: delete `pinterest-profile-lambda-role`
