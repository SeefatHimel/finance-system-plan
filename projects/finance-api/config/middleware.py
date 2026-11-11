"""Keep authenticated API data and token responses out of HTTP caches."""


class PrivateApiResponseMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            request.path.startswith("/api/")
            and "no-store" not in response.get("Cache-Control", "").lower()
        ):
            response["Cache-Control"] = "private, no-store"
        return response
