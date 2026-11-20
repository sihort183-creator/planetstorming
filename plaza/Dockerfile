FROM python:3.13-slim
WORKDIR /app
RUN mkdir /data && chown 10001:10001 /data
COPY *.py *.html *.css *.js *.json ./
USER 10001:10001
ENV PORT=8765
EXPOSE 8765
CMD ["sh","-c","exec python 광장-서버.py --bind 0.0.0.0 --port \"$PORT\" --data /data"]