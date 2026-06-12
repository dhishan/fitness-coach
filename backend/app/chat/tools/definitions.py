TOOLS = [
    {"type": "function", "function": {
        "name": "get_dashboard_summary",
        "description": "Weekly training summary: sessions this week, trained dates, week volume, streak in weeks.",
        "parameters": {"type": "object", "properties": {
            "reference_date": {"type": "string", "description": "YYYY-MM-DD local date; defaults to today"}},
            "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_workouts",
        "description": "List recent workouts with entries and sets. Optional date range.",
        "parameters": {"type": "object", "properties": {
            "from_date": {"type": "string"}, "to_date": {"type": "string"},
            "limit": {"type": "integer", "default": 10}},
            "required": []},
    }},
    {"type": "function", "function": {
        "name": "get_exercise_progress",
        "description": "Per-date top working-set weight and volume series for one exercise.",
        "parameters": {"type": "object", "properties": {
            "exercise_id": {"type": "string"}},
            "required": ["exercise_id"]},
    }},
    {"type": "function", "function": {
        "name": "get_exercise_history",
        "description": "Sets performed for an exercise in the most recent workouts containing it.",
        "parameters": {"type": "object", "properties": {
            "exercise_id": {"type": "string"}, "limit": {"type": "integer", "default": 3}},
            "required": ["exercise_id"]},
    }},
    {"type": "function", "function": {
        "name": "get_alternatives",
        "description": "Alternative exercises with the same movement pattern ranked by muscle overlap.",
        "parameters": {"type": "object", "properties": {
            "exercise_id": {"type": "string"}},
            "required": ["exercise_id"]},
    }},
    {"type": "function", "function": {
        "name": "list_exercises",
        "description": "Search the exercise catalog by muscle, movement pattern, or name.",
        "parameters": {"type": "object", "properties": {
            "muscle": {"type": "string"}, "pattern": {"type": "string"}, "q": {"type": "string"}},
            "required": []},
    }},
]
