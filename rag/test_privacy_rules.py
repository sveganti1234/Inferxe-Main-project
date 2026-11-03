import urllib.request
import json

tests = [
    # 1. Public User Interface
    {
        'name': 'Public - Wallet Query',
        'payload': {'message': 'how wallet works in this web site', 'user_role': 'guest', 'current_path': '/'},
        'must_have': ['Login or Sign Up:', '[Sign In](/login)'],
        'must_not_have': ['Navigate to Wallet:', 'UPI']
    },
    {
        'name': 'Public - Provider Analysis Query',
        'payload': {'message': 'how provider analysis works in this web site', 'user_role': 'guest', 'current_path': '/'},
        'must_have': ['Login or Sign Up:', 'Administrator account', '[Sign In](/login)'],
        'must_not_have': ['Active Providers:']
    },
    {
        'name': 'Public - Admin Features Query',
        'payload': {'message': 'give me admin feratures and details', 'user_role': 'guest', 'current_path': '/'},
        'must_have': ['Login or Sign Up:', 'Administrator account', '[Sign In](/login)'],
        'must_not_have': ['Role Management (RBAC)']
    },
    # 2. Customer after login inside Dashboard
    {
        'name': 'Customer Dashboard - Wallet Query',
        'payload': {'message': 'how wallet works in this web site', 'user_role': 'customer', 'current_path': '/dashboard/wallet'},
        'must_have': ['Navigate to Wallet:', 'Choose Top-Up Amount:', 'Pay Using UPI', 'Complete Payment:', 'Current Balance Status:'],
        'must_not_have': []
    },
    {
        'name': 'Customer Dashboard - Admin Features Leakage Prevention',
        'payload': {'message': 'give me admin feratures and details', 'user_role': 'customer', 'current_path': '/dashboard'},
        'must_have': ['restricted to Administrator accounts', 'Customers do not have permission'],
        'must_not_have': ['Role Management (RBAC)', 'Provider Management']
    },
    {
        'name': 'Customer Dashboard - Provider Analysis Leakage Prevention',
        'payload': {'message': 'provider analysis in the admin page', 'user_role': 'customer', 'current_path': '/dashboard'},
        'must_have': ['restricted to Administrator accounts', 'Customers do not have permission'],
        'must_not_have': ['JarvisLabs', 'Node Telemetry']
    },
    # 3. Administrator inside Admin Dashboard
    {
        'name': 'Admin Dashboard - Provider Analysis',
        'payload': {'message': 'how provider analysis works in this web site', 'user_role': 'admin', 'current_path': '/dashboard/provider'},
        'must_have': ['Provider Analysis & Node Telemetry:', 'Active Providers:', 'JarvisLabs'],
        'must_not_have': ['Customers do not have permission']
    },
    {
        'name': 'Admin Dashboard - Admin Features',
        'payload': {'message': 'give me admin feratures and details', 'user_role': 'admin', 'current_path': '/dashboard'},
        'must_have': ['Inferxe Administration Features:', 'Provider Management & Analysis:', 'User & Role Management (RBAC)'],
        'must_not_have': ['Customers do not have permission']
    }
]

all_passed = True
for t in tests:
    req = urllib.request.Request(
        'http://127.0.0.1:8000/api/chat',
        data=json.dumps(t['payload']).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        ans = data.get('response', '')
        sources = data.get('sources', [])
        
        passed = True
        for mh in t['must_have']:
            if mh not in ans:
                print(f"FAIL [{t['name']}]: Missing '{mh}' in response:\n{ans}")
                passed = False
        for mnh in t['must_not_have']:
            if mnh in ans:
                print(f"FAIL [{t['name']}]: Should NOT contain '{mnh}' in response:\n{ans}")
                passed = False
        if len(sources) > 0:
            print(f"FAIL [{t['name']}]: Sources should be empty, got {len(sources)}")
            passed = False
            
        if passed:
            print(f"PASS: {t['name']}")
        else:
            all_passed = False

if all_passed:
    print("\n>>> ALL PRIVACY & ROLE GUARDRAILS PASSED 100%! <<<")
