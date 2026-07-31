# SMS Viewer & Exporter — containerized static site
#
# smsviewer is a pure client-side web app (HTML/CSS/JS) for viewing SMS backup
# XML files. It has no backend and no database; everything runs in the browser.
# The vendor/ directory is committed to the repo, so we just serve the tree
# with nginx — no build step required.

FROM nginx:alpine

# Replace the default nginx static site with the smsviewer sources.
COPY . /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]