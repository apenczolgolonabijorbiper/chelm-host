"""Independent persistent SQL fixture for the optional D1 adapter; not hosted D1 evidence."""
import json
import sqlite3
import sys

request = json.load(sys.stdin)
with sqlite3.connect(sys.argv[1], timeout=5) as connection:
    connection.row_factory = sqlite3.Row
    if request['kind'] == 'schema':
        connection.executescript(request['sql'])
        result = {}
    else:
        cursor = connection.execute(request['sql'], request['args'])
        if request['kind'] == 'first':
            row = cursor.fetchone()
            result = dict(row) if row else None
        else:
            result = {'changes': cursor.rowcount}
print(json.dumps(result))
