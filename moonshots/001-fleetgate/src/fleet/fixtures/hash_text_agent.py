import hashlib

from basic_agent import BasicAgent


class HashTextAgent(BasicAgent):
    def __init__(self):
        self.name = "HashText"
        self.metadata = {
            "name": self.name,
            "description": "Return a deterministic SHA-256 digest for text.",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, text="", **kwargs):
        return hashlib.sha256(str(text).encode("utf-8")).hexdigest()
