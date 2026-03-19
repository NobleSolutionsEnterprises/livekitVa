import re
from typing import Optional

TEMPLATE_VARIABLES = {
    "sms_postcall_template": {"business_name", "caller_number", "call_summary", "call_date"},
    "sms_reminder_template": {"business_name", "appointment_date", "appointment_time", "caller_name"},
}

VARIABLE_PATTERN = re.compile(r"\{\{(\w+)\}\}")


def validate_template(template_type: str, template: str) -> list[str]:
    """Return list of unknown variable names found in template. Empty = valid."""
    allowed = TEMPLATE_VARIABLES.get(template_type, set())
    found = set(VARIABLE_PATTERN.findall(template))
    return list(found - allowed)


def render_template(template: str, variables: dict) -> str:
    """Substitute {{variable}} placeholders. Unknown vars are left unchanged."""
    def replace(match):
        key = match.group(1)
        return str(variables.get(key, match.group(0)))
    return VARIABLE_PATTERN.sub(replace, template)
