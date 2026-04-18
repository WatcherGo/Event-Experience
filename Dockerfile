# Build stage
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Expose port (Cloud Run defaults to 8080)
EXPOSE 8080

# Start application
# We run backend.main:app because of the package structure
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
