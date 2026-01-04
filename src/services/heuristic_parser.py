"""Deterministic heuristic parsing for voice input - no LLM calls."""

import re
from datetime import datetime, timedelta

from src.models.list import List


class HeuristicParser:
    """Parse voice input using deterministic rules."""

    @staticmethod
    def parse_list_reference(text: str, lists: list[List], list_type: str) -> int | None:
        """Extract list ID from text using fuzzy matching.

        Searches for list names (case-insensitive, substring) in the voice text.
        Returns first matching list of the correct type, or None.

        Examples:
        - "add milk to costco" with lists ["Costco", "Walmart"] -> Costco's ID
        - "remind me to call mom on my personal list" -> personal list ID
        """
        text_lower = text.lower()

        # Try exact word boundary match first
        for lst in lists:
            if lst.list_type == list_type and re.search(
                rf"\b{re.escape(lst.name.lower())}\b", text_lower
            ):
                return lst.id

        # Fallback: substring match
        for lst in lists:
            if lst.list_type == list_type and lst.name.lower() in text_lower:
                return lst.id

        return None

    @staticmethod
    def parse_grocery_items(text: str) -> list[str]:
        """Extract item names from grocery voice input.

        Rules:
        - Split on "and", commas, "also"
        - Remove common prefixes: "add", "get", "buy", "pick up", "need"
        - Remove list references: "to [list]", "from [list]", "to the [list] list"
        """
        # Remove common action words at the start
        text = re.sub(r"^(add|get|buy|pick up|grab|need)\s+", "", text, flags=re.I)

        # Remove "to/from/on/for [the] X [list]" patterns
        # Handles: "to costco", "to the costco list", "from walmart", etc.
        text = re.sub(r"\s+(to|from|on|for)\s+(the\s+)?[\w\s]+\s*list\s*$", "", text, flags=re.I)
        text = re.sub(r"\s+(to|from|on|for)\s+(the\s+)?\w+\s*$", "", text, flags=re.I)

        # Split on delimiters
        items = re.split(r"\s*(?:,|and|also)\s*", text)

        return [item.strip() for item in items if item.strip()]

    @staticmethod
    def parse_task_due_date(text: str, now: datetime) -> datetime | None:
        """Parse due date/time from task voice input.

        Supported patterns:
        - "tomorrow" / "tomorrow at 3pm"
        - "in X hours/minutes"
        - "at 3pm" / "at 15:00"
        - "on monday" / "next tuesday"
        - "tonight" / "this evening"
        """
        text_lower = text.lower()

        # "in X minutes/hours"
        match = re.search(r"in\s+(\d+)\s*(minute|min|hour|hr)s?", text_lower)
        if match:
            value = int(match.group(1))
            unit = match.group(2)
            if "min" in unit:
                return now + timedelta(minutes=value)
            else:
                return now + timedelta(hours=value)

        # "tomorrow"
        if "tomorrow" in text_lower:
            target = now + timedelta(days=1)
            # Check for time
            time_match = re.search(r"at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text_lower)
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2) or 0)
                meridiem = time_match.group(3)
                if meridiem == "pm" and hour != 12:
                    hour += 12
                elif meridiem == "am" and hour == 12:
                    hour = 0
                return target.replace(hour=hour, minute=minute, second=0, microsecond=0)
            return target.replace(hour=9, minute=0, second=0, microsecond=0)  # Default 9am

        # "today" / "tonight" / "this evening"
        if "tonight" in text_lower or "this evening" in text_lower:
            return now.replace(hour=20, minute=0, second=0, microsecond=0)  # 8pm
        if "today" in text_lower:
            # Check for time
            time_match = re.search(r"at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text_lower)
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2) or 0)
                meridiem = time_match.group(3)
                if meridiem == "pm" and hour != 12:
                    hour += 12
                elif meridiem == "am" and hour == 12:
                    hour = 0
                return now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            return now.replace(hour=17, minute=0, second=0, microsecond=0)  # 5pm default

        # Day names: "on monday", "next tuesday"
        days = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ]
        for i, day in enumerate(days):
            if day in text_lower:
                current_weekday = now.weekday()
                days_ahead = i - current_weekday
                if days_ahead <= 0:  # Target day already happened this week
                    days_ahead += 7
                target = now + timedelta(days=days_ahead)
                # Check for time
                time_match = re.search(r"at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text_lower)
                if time_match:
                    hour = int(time_match.group(1))
                    minute = int(time_match.group(2) or 0)
                    meridiem = time_match.group(3)
                    if meridiem == "pm" and hour != 12:
                        hour += 12
                    elif meridiem == "am" and hour == 12:
                        hour = 0
                    return target.replace(hour=hour, minute=minute, second=0, microsecond=0)
                return target.replace(hour=9, minute=0, second=0, microsecond=0)

        # "at Xpm/am" (without other date context - assume today or tomorrow)
        time_match = re.search(r"at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text_lower)
        if time_match:
            hour = int(time_match.group(1))
            minute = int(time_match.group(2) or 0)
            meridiem = time_match.group(3)
            if meridiem == "pm" and hour != 12:
                hour += 12
            elif meridiem == "am" and hour == 12:
                hour = 0
            target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if target <= now:
                target += timedelta(days=1)
            return target

        return None

    @staticmethod
    def parse_reminder(text: str) -> dict:
        """Parse reminder information from voice input.

        Returns:
            {
                'is_immediate': bool,  # "remind me in X" = due_date with no offset
                'offset': str | None,  # "remind 30 minutes before" = "30m"
            }
        """
        text_lower = text.lower()

        # "remind me in X" pattern - immediate reminder (due_date = reminder time)
        if re.search(r"remind\s+me\s+in\s+\d+", text_lower):
            return {"is_immediate": True, "offset": None}

        # "remind X before" pattern
        match = re.search(r"remind\s+(\d+)\s*(minute|min|hour|hr)s?\s*before", text_lower)
        if match:
            value = int(match.group(1))
            unit = match.group(2)
            offset = f"{value}m" if "min" in unit else f"{value}h"
            return {"is_immediate": False, "offset": offset}

        return {"is_immediate": False, "offset": None}

    @staticmethod
    def parse_recurrence(text: str) -> str | None:
        """Parse recurrence pattern from voice input.

        Returns: 'daily', 'weekly', 'monthly', or None
        """
        text_lower = text.lower()

        if re.search(r"every\s*day", text_lower) or "daily" in text_lower:
            return "daily"
        if re.search(r"every\s*week", text_lower) or "weekly" in text_lower:
            return "weekly"
        if re.search(r"every\s*month", text_lower) or "monthly" in text_lower:
            return "monthly"

        return None

    @staticmethod
    def parse_task_name(text: str) -> str:
        """Extract task name by removing time/reminder/recurrence phrases."""
        # Remove "remind me (to)" at start
        text = re.sub(r"^\s*remind\s+me\s+(to\s+)?", "", text, flags=re.I)

        # Remove "in X minutes/hours" patterns
        text = re.sub(r"\s*in\s+\d+\s*(minute|min|hour|hr)s?", "", text, flags=re.I)

        # Remove "at X:XX am/pm" patterns
        text = re.sub(r"\s*at\s+\d{1,2}(:\d{2})?\s*(am|pm)?", "", text, flags=re.I)

        # Remove day references
        text = re.sub(r"\s*tomorrow\b", "", text, flags=re.I)
        text = re.sub(r"\s*today\b", "", text, flags=re.I)
        text = re.sub(r"\s*tonight\b", "", text, flags=re.I)
        text = re.sub(r"\s*this\s+(evening|morning|afternoon)\b", "", text, flags=re.I)

        # Remove recurrence patterns
        text = re.sub(r"\s*every\s*(day|week|month)", "", text, flags=re.I)
        text = re.sub(r"\s*(daily|weekly|monthly)\b", "", text, flags=re.I)

        # Remove day names
        text = re.sub(
            r"\s*(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
            "",
            text,
            flags=re.I,
        )

        # Remove "on/to my X list" patterns
        text = re.sub(r"\s*(on|to)\s+my\s+\w+\s*list", "", text, flags=re.I)

        # Remove "remind X before" patterns
        text = re.sub(r"\s*remind\s+\d+\s*(minute|min|hour|hr)s?\s*before", "", text, flags=re.I)

        return text.strip()
