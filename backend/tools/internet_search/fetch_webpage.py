import logging
import requests
import re
import urllib3

# Disable warnings about SSL verification
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "fetch_webpage",
    "description": "Fetches and extracts the main content from a webpage URL. Returns the title, full text content, and metadata.",
    "input_schema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL of the webpage to fetch.",
            },
            "extract_main_content": {
                "type": "boolean",
                "description": "Whether to extract just the main content (true) or return the full HTML (false).",
                "default": True,
            },
        },
        "required": ["url"],
    },
    "default_enabled": True,
}

def extract_title(html_content):
    """Extract title from HTML using regex."""
    title_match = re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
    if title_match:
        return title_match.group(1).strip()
    return ""

def simple_html_to_text(html_content):
    """Very simple HTML to text conversion using regex."""
    # Remove script and style elements
    html_content = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<style[^>]*>.*?</style>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    
    # Replace common block elements with newlines
    html_content = re.sub(r'</(div|p|h1|h2|h3|h4|h5|h6|article|section|main)>', '\n\n', html_content, flags=re.IGNORECASE)
    
    # Remove all other HTML tags
    html_content = re.sub(r'<[^>]*>', '', html_content)
    
    # Clean up whitespace
    html_content = re.sub(r'\n\s*\n', '\n\n', html_content)
    html_content = re.sub(r'[ \t]+', ' ', html_content)
    
    return html_content.strip()

def call_tool(tool_input: dict, context=None):
    url = (tool_input.get("url") or "").strip()
    extract_content = tool_input.get("extract_main_content", True)
    
    if not url:
        return 400, "url is required and cannot be empty. Provide a valid webpage URL."
    
    try:
        # Set a user agent to avoid being blocked
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        
        # Disable SSL verification to handle certificate issues
        response = requests.get(url, headers=headers, timeout=15, verify=False)
        
        # Check if the request was successful
        if response.status_code != 200:
            return 500, f"Error: HTTP status code {response.status_code}"
            
        html_content = response.text
        
        # Extract the title
        title = extract_title(html_content)
        
        # Get metadata
        metadata = {
            "url": url,
            "status_code": response.status_code,
            "content_type": response.headers.get('Content-Type', ''),
        }
        
        # Extract content based on user preference
        if extract_content:
            content = simple_html_to_text(html_content)
        else:
            content = html_content
        
        logger.info(f"Successfully fetched webpage: {url}")
        return 200, {
            "title": title,
            "content": content,
            "metadata": metadata,
        }
    
    except requests.exceptions.RequestException as e:
        logger.error(f"Error fetching webpage {url}: {str(e)}")
        return 500, f"Error fetching webpage: {str(e)}"
    except Exception as e:
        logger.error(f"Unexpected error processing webpage {url}: {str(e)}")
        return 500, f"Unexpected error: {str(e)}"