# Build the React dashboard, then serve the static files with nginx.
FROM node:20-alpine AS build
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json* ./
# npm intermittently omits the platform-specific rollup binary (npm/cli#4828),
# which breaks `vite build` on Alpine/musl with:
#   Cannot find module '@rollup/rollup-linux-x64-musl'
# Install deps, then force the musl rollup binary for the build arch at rollup's
# exact version so the build is deterministic. node's process.arch (x64/arm64)
# matches rollup's package naming, so this is correct on any builder.
RUN npm install --include=optional \
    && npm install --no-save "@rollup/rollup-linux-$(node -p process.arch)-musl@$(node -p "require('rollup/package.json').version")"
COPY dashboard/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
