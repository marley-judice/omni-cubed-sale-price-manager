FROM node:20-alpine
RUN apk add --no-cache openssl tzdata

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Los_Angeles

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
