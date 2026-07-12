from basic_agent import BasicAgent


class CaseConvertAgent(BasicAgent):
    def __init__(self):
        self.name = "CaseConvert"
        self.metadata = {
            "name": self.name,
            "description": "Convert text to upper, lower, or title case.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "mode": {
                        "type": "string",
                        "enum": ["upper", "lower", "title"],
                    },
                },
                "required": ["text", "mode"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, text="", mode="lower", **kwargs):
        operations = {
            "upper": str.upper,
            "lower": str.lower,
            "title": str.title,
        }
        if mode not in operations:
            return "unsupported mode"
        return operations[mode](str(text))
