import re
import unicodedata

from basic_agent import BasicAgent


class SlugifyTextAgent(BasicAgent):
    def __init__(self):
        self.name = "SlugifyText"
        self.metadata = {
            "name": self.name,
            "description": "Convert text into a stable ASCII URL slug.",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, text="", **kwargs):
        normalized = unicodedata.normalize("NFKD", str(text))
        ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
        words = re.findall(r"[a-z0-9]+", ascii_text.lower())
        return "-".join(words)
