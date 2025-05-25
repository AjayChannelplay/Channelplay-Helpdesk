FROM node:16-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app source code
COPY . .

# Build TypeScript code
RUN npm run build

# Create logs directory
RUN mkdir -p logs

# Expose the port
EXPOSE 8080

# Set NODE_ENV to production
ENV NODE_ENV production

# Start the application with PM2
CMD ["npm", "run", "start:prod"]
