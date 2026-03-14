import subprocess
import json
import sys
import time

def test_mcp_server():
    # Start the server
    process = subprocess.Popen(
        ["npx", "-y", "@modelcontextprotocol/server-github"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        shell=True
    )

    # Initialize message
    init_msg = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "TestClient", "version": "1.0.0"}
        }
    }

    # Send initialize
    process.stdin.write(json.dumps(init_msg) + "\n")
    process.stdin.flush()

    # Read response
    line = process.stdout.readline()
    print("Initialize Response:", line)

    # Send list_tools
    list_tools_msg = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "list_tools",
        "params": {}
    }
    process.stdin.write(json.dumps(list_tools_msg) + "\n")
    process.stdin.flush()

    # Read response
    line = process.stdout.readline()
    print("List Tools Response:", line)

    # Terminate
    process.terminate()

if __name__ == "__main__":
    test_mcp_server()
