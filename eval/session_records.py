"""Read Supervisor records from legacy logs and native message/Inbox carriers.

This is a read-only view. Stored events and their hashes are never rewritten.
"""

def control_event(event):
    kind = event.get('type')
    data = event.get('data', {})
    source = None
    if kind == 'user/message':
        source = data.get('source', {})
        if source.get('queued'):
            return event  # Already recorded by its Inbox insertion.
    elif kind == 'agent/inbox/spliced':
        inserted = data.get('inserted', [])
        if len(inserted) == 1:
            source = inserted[0].get('source', {})
    if not source or source.get('kind') != 'task-supervisor-record':
        return event
    record = source.get('record')
    if not isinstance(record, dict) or set(record) != {'namespace', 'schemaVersion', 'kind', 'recordId', 'payload'}:
        raise ValueError('Invalid native Supervisor record')
    if not all(isinstance(record[field], str) and record[field] for field in ('namespace', 'kind', 'recordId')):
        raise ValueError('Invalid native Supervisor record identity')
    if type(record['schemaVersion']) is not int or record['schemaVersion'] < 1:
        raise ValueError('Invalid native Supervisor record version')
    return {**event, 'type': 'extension/record', 'data': record}
