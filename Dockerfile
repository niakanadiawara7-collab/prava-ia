# Image de production de Prava IA
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PRAVA_DATA=/data PORT=3000 TZ=Europe/Paris
RUN apk add --no-cache tzdata
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Les données (comptes, devis, factures…) vivent dans /data : montez-y un volume persistant
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/sante || exit 1
CMD ["node", "server.js"]
