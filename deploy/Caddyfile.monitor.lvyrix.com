# GrokIQ frontend and API.
# The production frontend runs on nginx at 8091; API requests bypass nginx and
# connect directly to the backend at 8090.
# SSE/chat streams must not pass through encode; gzip waits for EOF.
monitor.lvyrix.com {
	@api path /api /api/*
	handle @api {
		reverse_proxy 127.0.0.1:8090 {
			flush_interval -1
		}
	}

	@immutable_assets path /assets/*
	header @immutable_assets Cache-Control "public, max-age=31536000, immutable"

	@html_shell path / /index.html
	header @html_shell Cache-Control "no-cache"

	handle {
		encode zstd gzip
		reverse_proxy 127.0.0.1:8091
	}
}
