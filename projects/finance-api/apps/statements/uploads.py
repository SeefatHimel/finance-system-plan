from django.core.files.uploadhandler import FileUploadHandler
from rest_framework.exceptions import ValidationError

from .parser import MAX_BYTES


class BoundedStatementUploadHandler(FileUploadHandler):
    """Reject oversized input before Django writes an entire upload to disk."""

    def __init__(self, request=None):
        super().__init__(request)
        self.received = 0

    def handle_raw_input(
        self, input_data, META, content_length, boundary, encoding=None
    ):
        if content_length and content_length > MAX_BYTES + 65536:
            raise ValidationError({"file": ["Choose a PDF no larger than 4 MiB."]})

    def receive_data_chunk(self, raw_data, start):
        self.received += len(raw_data)
        if self.received > MAX_BYTES:
            raise ValidationError({"file": ["Choose a PDF no larger than 4 MiB."]})
        return raw_data

    def file_complete(self, file_size):
        return None
