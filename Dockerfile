# Use Node.js 18 as base image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port (using the PORT environment variable that Render provides)
EXPOSE $PORT

# Start the application
CMD ["npm", "start"]