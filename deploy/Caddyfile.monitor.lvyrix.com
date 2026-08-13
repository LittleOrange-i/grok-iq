# GrokIQ frontend and API.
# Caddy only reaches the loopback-bound frontend. Its nginx forwards /api to
# the backend over the private Compose network, so the backend needs no host port.
monitor.lvyrix.com {
	@not_chat_stream not path /api/chat/completions
	encode @not_chat_stream zstd gzip

	@immutable_assets path /assets/*
	header @immutable_assets Cache-Control "public, max-age=31536000, immutable"

	@html_shell path / /index.html
	header @html_shell Cache-Control "no-cache"

	handle {
		reverse_proxy 127.0.0.1:8091
	}
}
