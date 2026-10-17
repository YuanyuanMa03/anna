#!/usr/bin/env bash
# Create the "Anna Local Signing" code-signing identity (self-signed, free, no Apple account).
# Every Anna build signed with it has the same code identity, so macOS keeps Keychain and folder permissions
# across updates instead of asking for your password again. Run once on the machine that builds releases:
#   bash scripts/create-signing-identity.sh
# macOS asks for your login password once, to trust the certificate for code signing.
# It also writes ~/.anna-signing/anna-signing.p12 (+ password) for CI: store them as GitHub secrets
#   ANNA_SIGNING_P12 (base64 of the .p12) and ANNA_SIGNING_PASSWORD.
set -euo pipefail
NAME="Anna Local Signing"
OUT="$HOME/.anna-signing"

if security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
  echo "Signing identity already exists: $NAME"
  exit 0
fi

mkdir -p "$OUT"
chmod 700 "$OUT"
WORK="$(mktemp -d)"
# Keep the real exit status: a cleanup trap must not turn a failure into success.
trap 'status=$?; rm -rf "$WORK"; exit $status' EXIT
cat > "$WORK/ext.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
openssl req -x509 -newkey rsa:3072 -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -days 7300 -nodes -config "$WORK/ext.cnf" 2>/dev/null
PASSWORD="$(openssl rand -hex 16)"
# macOS `security import` only reads PKCS#12 files with the legacy algorithms.
openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -out "$OUT/anna-signing.p12" -passout "pass:$PASSWORD" -name "$NAME" -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
printf '%s' "$PASSWORD" > "$OUT/password.txt"
cp "$WORK/cert.pem" "$OUT/anna-signing.cer.pem"
chmod 600 "$OUT"/*

security import "$OUT/anna-signing.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASSWORD" -T /usr/bin/codesign
echo "macOS will now ask for your login password once, to trust this certificate for code signing."
security add-trusted-cert -r trustRoot -p codeSign -k "$HOME/Library/Keychains/login.keychain-db" "$OUT/anna-signing.cer.pem"

security find-identity -v -p codesigning | grep "\"$NAME\"" && echo "Done: pnpm package:mac will now sign with $NAME."
echo "The certificate files for CI are in $OUT (keep them safe and never commit them)."
