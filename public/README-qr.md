# Join QR code

`qr-join.png` is a **pre-generated, static** QR encoding exactly:

    https://tappedin.lol

It is served locally (no third-party request) so the join path cannot fail
because an external QR service is blocked, slow, or down at the venue.
The matching constant is `JOIN_URL` in `src/routes/projector/index.tsx` —
the QR and the printed address must always agree.

## Regenerating (only if the domain changes)

Update `JOIN_URL`, then:

    pip install segno opencv-python-headless
    python -c "import segno; segno.make('https://YOUR-DOMAIN', error='Q').save('public/qr-join.png', scale=20, border=4)"

Verify it actually decodes before committing:

    python -c "import cv2; print(cv2.QRCodeDetector().detectAndDecode(cv2.imread('public/qr-join.png'))[0])"

Error level Q is deliberate: for this URL it is the same 25x25 module grid as
L or M, so 25% error correction costs nothing in scan density.
