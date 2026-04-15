FROM python:3.12-slim

WORKDIR /app

# Install ML dependencies
COPY packages/ml-training/pyproject.toml .
RUN pip install --no-cache-dir lightgbm scikit-learn pandas numpy boto3 click requests

# Copy training code
COPY packages/ml-training/src/ src/
RUN pip install -e .

# Entry point: export features from D1, train, score, upload to R2
COPY scripts/train-and-deploy.sh .
RUN chmod +x train-and-deploy.sh

ENTRYPOINT ["./train-and-deploy.sh"]
