FROM docker.io/node:24.2.0-alpine

ENV HOSTNAME=0.0.0.0
ENV PORT=3001

WORKDIR /app

COPY .next/standalone ./
COPY .next/static ./packages/ui/.next/static
COPY public ./packages/ui/public

CMD [ "node", "packages/ui/server.js" ]
