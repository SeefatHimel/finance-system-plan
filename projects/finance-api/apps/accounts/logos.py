"""Bounded, owner-scoped account images, independent of filesystem storage."""

import base64
import binascii
import io
import re
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework import serializers

MAX_LOGO_BYTES = 1024 * 1024
MAX_LOGO_PIXELS = 16_000_000
LOGO_SIZE = 128
MAX_LOGO_INPUT_LENGTH = 4 * ((MAX_LOGO_BYTES + 2) // 3) + 32


class AccountLogoField(serializers.CharField):
    """Accept raster data URLs; persist only a small, metadata-free WebP."""

    def __init__(self, **kwargs):
        super().__init__(max_length=MAX_LOGO_INPUT_LENGTH, trim_whitespace=False, **kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if not value:
            return ""
        if len(value) > MAX_LOGO_INPUT_LENGTH:
            raise serializers.ValidationError("Choose a logo image no larger than 1 MB.")
        instance = getattr(self.parent, "instance", None)
        if instance is not None and value == instance.logo:
            return value
        match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)", value)
        if not match:
            raise serializers.ValidationError("Choose a PNG, JPG or WebP image up to 1 MB.")
        try:
            raw = base64.b64decode(match[2], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise serializers.ValidationError("This logo image could not be read.") from exc
        if len(raw) > MAX_LOGO_BYTES:
            raise serializers.ValidationError("Choose a logo image no larger than 1 MB.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(raw)) as source:
                    if source.format not in {"PNG", "JPEG", "WEBP"}:
                        raise ValueError("Unsupported image format")
                    if source.width * source.height > MAX_LOGO_PIXELS:
                        raise ValueError("Image dimensions are too large")
                    source.verify()
                with Image.open(io.BytesIO(raw)) as source:
                    # The first frame only. Rebuilding pixels removes EXIF,
                    # comments and other embedded metadata from saved images.
                    oriented = ImageOps.exif_transpose(source)
                    thumbnail = ImageOps.contain(oriented.convert("RGBA"), (LOGO_SIZE, LOGO_SIZE))
                    square = Image.new("RGBA", (LOGO_SIZE, LOGO_SIZE), (0, 0, 0, 0))
                    square.paste(thumbnail, ((LOGO_SIZE - thumbnail.width) // 2, (LOGO_SIZE - thumbnail.height) // 2))
                    output = io.BytesIO()
                    square.save(output, "WEBP", quality=85, method=4)
            return "data:image/webp;base64," + base64.b64encode(output.getvalue()).decode("ascii")
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
            raise serializers.ValidationError("This image is unreadable or too large. Choose a smaller PNG, JPG or WebP logo.") from exc
