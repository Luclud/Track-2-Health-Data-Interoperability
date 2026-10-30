#!/bin/sh
# Generate the signing key on first start, then run Synapse with our fixed config.
set -e
python -m synapse.app.homeserver --config-path /config/homeserver.yaml --keys-directory /data --generate-keys
exec python -m synapse.app.homeserver --config-path /config/homeserver.yaml
