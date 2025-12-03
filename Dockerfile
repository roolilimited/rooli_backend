ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-slim as base


LABEL fly_launch_runtime="NestJS"

# NestJS app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

#  Prisma requires OpenSSL
RUN apt-get update -y && apt-get install -y openssl


# Throw-away build stage to reduce size of final image
FROM base as build

# Install build tools
RUN apt-get update -qq && \
    apt-get install -y python-is-python3 pkg-config build-essential openssl

# Install node modules
COPY --link package-lock.json package.json ./
RUN npm install --legacy-peer-deps

# Copy application code
COPY --link . .

# Generate prisma schema
RUN npm run prisma:generate


# Build application
RUN npm run build

# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "npm", "run", "start:prod" ]