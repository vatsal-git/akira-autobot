import json
import logging
import os
import requests

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "web_search",
    "description": "Performs a web search using Google Custom Search API",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query. Make it comprehensive or breif based on requirement.",
            },
            "results_count": {
                "type": "integer",
                "description": "Number of search results to fetch.",
            },
        },
        "required": ["query", "results_count"],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    query = (tool_input.get("query") or "").strip()
    results_count = tool_input.get("results_count")
    if not query:
        return 400, "query is required and cannot be empty. Provide a search query string."
    search_session = requests.Session()
    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": os.getenv("SEARCH_API_KEY"),
        "cx": os.getenv("SEARCH_ENGINE_ID"),
        "q": query,
        "num": results_count or 5,
    }
    try:
        response = search_session.get(url, params=params)
        if response.status_code == 200:
            data = response.json()
            search_results = set()
            websites_searched = set()
            if "items" in data:
                for item in data["items"]:
                    if "displayLink" in item:
                        websites_searched.add(item.get("displayLink", ""))
                    search_results.add(
                        json.dumps(
                            {
                                "title": item.get("title", ""),
                                "snippet": item.get("snippet", ""),
                            }
                        )
                    )
            logger.info("Search completed, found %s results", len(search_results))
            return 200, {
                "search_results": list(search_results),
                "websites_searched": list(websites_searched),
            }
        return 500, f"Search API returned status code {response.status_code}"
    except Exception as e:
        logger.error("Error in web search: %s", e, exc_info=True)
        return 500, str(e)
