"""Unit tests for api/sms_templates.py."""
import pytest
from api.sms_templates import validate_template, render_template


def test_valid_postcall_template():
    errors = validate_template(
        "sms_postcall_template",
        "Thanks for calling {{business_name}}! Summary: {{call_summary}}",
    )
    assert errors == []


def test_unknown_variable_rejected():
    errors = validate_template(
        "sms_postcall_template",
        "Hello {{unknown_var}} from {{business_name}}",
    )
    assert "unknown_var" in errors


def test_reminder_template_variables():
    errors = validate_template(
        "sms_reminder_template",
        "Your appt at {{appointment_time}} on {{appointment_date}} with {{business_name}}. Name: {{caller_name}}",
    )
    assert errors == []


def test_render_substitutes_variables():
    result = render_template(
        "Hello {{business_name}}, your call on {{call_date}}",
        {"business_name": "Acme", "call_date": "2026-03-14"},
    )
    assert result == "Hello Acme, your call on 2026-03-14"


def test_render_leaves_unknown_vars():
    result = render_template(
        "Hello {{unknown}}",
        {"business_name": "Acme"},
    )
    assert "{{unknown}}" in result


def test_empty_template():
    result = render_template("", {})
    assert result == ""
