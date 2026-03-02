FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_HOMEPLANE_API_URL
ARG VITE_HOMEPLANE_API_KEY
ENV VITE_HOMEPLANE_API_URL=${VITE_HOMEPLANE_API_URL}
ENV VITE_HOMEPLANE_API_KEY=${VITE_HOMEPLANE_API_KEY}

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
