#!/bin/bash
# AquaLora Implementation Test Script
# This script verifies that Phases 1 & 2 are working correctly
# 
# Usage: ./test-implementation.sh
# Or on Windows: bash test-implementation.sh
#
# Prerequisites: Backend running on http://localhost:8000

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BACKEND_URL="http://localhost:8000"
ADMIN_USER="Admin"
ADMIN_PASS="Admin123"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
print_header() {
    echo -e "\n${YELLOW}══════════════════════════════════════════${NC}"
    echo -e "${YELLOW}$1${NC}"
    echo -e "${YELLOW}══════════════════════════════════════════${NC}\n"
}

print_test() {
    echo -e "${YELLOW}→ $1${NC}"
}

print_pass() {
    echo -e "${GREEN}✅ $1${NC}"
    ((TESTS_PASSED++))
}

print_fail() {
    echo -e "${RED}❌ $1${NC}"
    ((TESTS_FAILED++))
}

# Test 1: Health Check
print_header "TEST 1: Backend Health Check"
print_test "Checking if backend is running..."

RESPONSE=$(curl -s -w "\n%{http_code}" "${BACKEND_URL}/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    print_pass "Backend is responding (HTTP 200)"
    echo "Response: $BODY"
else
    print_fail "Backend not responding. Got HTTP $HTTP_CODE"
    echo "Make sure backend is running: python -m uvicorn app.main:app --reload"
    exit 1
fi

# Test 2: Authentication
print_header "TEST 2: Authentication"
print_test "Logging in with credentials (Admin/Admin123)..."

AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}")

HTTP_CODE=$(echo "$AUTH_RESPONSE" | tail -n1)
BODY=$(echo "$AUTH_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    TOKEN=$(echo "$BODY" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
    if [ -n "$TOKEN" ]; then
        print_pass "Authentication successful, received JWT token"
        export TOKEN="$TOKEN"
    else
        print_fail "Got HTTP 200 but no access_token in response"
        echo "Response: $BODY"
        exit 1
    fi
else
    print_fail "Authentication failed (HTTP $HTTP_CODE)"
    echo "Response: $BODY"
    exit 1
fi

# Test 3: Get Initial Readings
print_header "TEST 3: Get Initial Readings"
print_test "Fetching latest readings (should be empty initially)..."

READ_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${BACKEND_URL}/readings/latest" \
    -H "Content-Type: application/json")

HTTP_CODE=$(echo "$READ_RESPONSE" | tail -n1)
BODY=$(echo "$READ_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    print_pass "Readings endpoint responding"
    echo "Response: $BODY"
else
    print_fail "Readings endpoint returned HTTP $HTTP_CODE"
fi

# Test 4: Post Test Reading
print_header "TEST 4: Post Test Reading"
print_test "Posting test reading to simulate desktop sync..."

SYNC_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/readings/sync" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
        "readings": [
            {
                "node_id": "test-node-001",
                "timestamp": "2026-08-30T12:00:00Z",
                "temperature": 28.5,
                "turbidity": 2.1,
                "tds": 450,
                "ph": 7.2,
                "pond_type": "tilapia",
                "battery_pct": 85,
                "rssi": -65
            }
        ]
    }')

HTTP_CODE=$(echo "$SYNC_RESPONSE" | tail -n1)
BODY=$(echo "$SYNC_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    STORED=$(echo "$BODY" | grep -o '"stored":[0-9]*' | cut -d':' -f2)
    if [ "$STORED" = "1" ]; then
        print_pass "Reading synced successfully (stored: 1)"
        export READING_STORED=1
    else
        print_fail "Reading sync response shows stored: $STORED (expected 1)"
        echo "Response: $BODY"
    fi
else
    print_fail "Reading sync failed (HTTP $HTTP_CODE)"
    echo "Response: $BODY"
fi

# Test 5: Verify Reading Was Stored
print_header "TEST 5: Verify Reading Was Stored"
print_test "Fetching latest readings (should now include test reading)..."

READ_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${BACKEND_URL}/readings/latest" \
    -H "Content-Type: application/json")

HTTP_CODE=$(echo "$READ_RESPONSE" | tail -n1)
BODY=$(echo "$READ_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q "test-node-001"; then
        print_pass "Test reading found in latest readings"
        echo "Sample: $(echo "$BODY" | head -c 200)..."
    else
        print_fail "Test reading not found in latest readings"
        echo "Response: $BODY"
    fi
else
    print_fail "Failed to fetch readings"
fi

# Test 6: Test Deduplication
print_header "TEST 6: Test Deduplication (No Duplicates)"
print_test "Posting same reading again (should reject as duplicate)..."

DEDUP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/readings/sync" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
        "readings": [
            {
                "node_id": "test-node-001",
                "timestamp": "2026-08-30T12:00:00Z",
                "temperature": 28.5,
                "turbidity": 2.1,
                "tds": 450,
                "ph": 7.2,
                "pond_type": "tilapia",
                "battery_pct": 85,
                "rssi": -65
            }
        ]
    }')

HTTP_CODE=$(echo "$DEDUP_RESPONSE" | tail -n1)
BODY=$(echo "$DEDUP_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    STORED=$(echo "$BODY" | grep -o '"stored":[0-9]*' | cut -d':' -f2)
    if [ "$STORED" = "0" ]; then
        print_pass "Deduplication working correctly (stored: 0, rejected duplicate)"
    else
        print_fail "Deduplication not working (stored: $STORED, expected 0)"
        echo "Response: $BODY"
    fi
else
    print_fail "Deduplication test failed (HTTP $HTTP_CODE)"
fi

# Test 7: Get Initial Alerts
print_header "TEST 7: Get Initial Alerts"
print_test "Fetching latest alerts (should be empty initially)..."

ALERT_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${BACKEND_URL}/alerts/latest" \
    -H "Content-Type: application/json")

HTTP_CODE=$(echo "$ALERT_RESPONSE" | tail -n1)
BODY=$(echo "$ALERT_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    print_pass "Alerts endpoint responding (NEW ENDPOINT!)"
    echo "Response: $BODY"
else
    print_fail "Alerts endpoint returned HTTP $HTTP_CODE"
    echo "This endpoint may not exist - check backend /alerts/latest implementation"
fi

# Test 8: Post Test Alert
print_header "TEST 8: Post Test Alert (NEW FEATURE!)"
print_test "Posting test alert to backend..."

ALERT_SYNC=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/alerts/sync" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
        "alerts": [
            {
                "node_id": "test-node-001",
                "timestamp": "2026-08-30T12:15:00Z",
                "parameter": "temperature",
                "severity": "critical",
                "message": "Temperature exceeded threshold (32°C > 30°C)"
            }
        ]
    }')

HTTP_CODE=$(echo "$ALERT_SYNC" | tail -n1)
BODY=$(echo "$ALERT_SYNC" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    STORED=$(echo "$BODY" | grep -o '"stored":[0-9]*' | cut -d':' -f2)
    if [ "$STORED" = "1" ]; then
        print_pass "Alert synced successfully (stored: 1) - PHASE 2 WORKING!"
        export ALERT_STORED=1
    else
        print_fail "Alert sync response shows stored: $STORED (expected 1)"
        echo "Response: $BODY"
    fi
else
    print_fail "Alert sync failed (HTTP $HTTP_CODE)"
    echo "Response: $BODY"
    echo "This endpoint may not exist - check backend /alerts/sync implementation"
fi

# Test 9: Verify Alert Was Stored
print_header "TEST 9: Verify Alert Was Stored"
print_test "Fetching latest alerts (should now include test alert)..."

ALERT_GET=$(curl -s -w "\n%{http_code}" -X GET "${BACKEND_URL}/alerts/latest" \
    -H "Content-Type: application/json")

HTTP_CODE=$(echo "$ALERT_GET" | tail -n1)
BODY=$(echo "$ALERT_GET" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q "test-node-001"; then
        print_pass "Test alert found in latest alerts"
        echo "Sample: $(echo "$BODY" | head -c 200)..."
    else
        print_fail "Test alert not found in latest alerts"
        echo "Response: $BODY"
    fi
else
    print_fail "Failed to fetch alerts"
fi

# Test 10: Test Alert Deduplication
print_header "TEST 10: Test Alert Deduplication"
print_test "Posting same alert again (should reject as duplicate)..."

ALERT_DEDUP=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/alerts/sync" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
        "alerts": [
            {
                "node_id": "test-node-001",
                "timestamp": "2026-08-30T12:15:00Z",
                "parameter": "temperature",
                "severity": "critical",
                "message": "Temperature exceeded threshold (32°C > 30°C)"
            }
        ]
    }')

HTTP_CODE=$(echo "$ALERT_DEDUP" | tail -n1)
BODY=$(echo "$ALERT_DEDUP" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    STORED=$(echo "$BODY" | grep -o '"stored":[0-9]*' | cut -d':' -f2)
    if [ "$STORED" = "0" ]; then
        print_pass "Alert deduplication working (stored: 0, rejected duplicate)"
    else
        print_fail "Alert deduplication not working (stored: $STORED, expected 0)"
        echo "Response: $BODY"
    fi
else
    print_fail "Alert deduplication test failed (HTTP $HTTP_CODE)"
fi

# Final Summary
print_header "TEST SUMMARY"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ ALL TESTS PASSED! Implementation is working correctly!${NC}\n"
    echo "Next steps:"
    echo "  1. Review TESTING_AND_VERIFICATION.md for detailed test cases"
    echo "  2. Test with mobile app by fetching /readings/latest and /alerts/latest"
    echo "  3. Start desktop app and verify sync happens automatically"
    echo "  4. Proceed to Phase 3 (pH integration)"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed. Review the errors above.${NC}\n"
    echo "Common issues:"
    echo "  - Backend not running: python -m uvicorn app.main:app --reload"
    echo "  - Wrong backend URL: Update BACKEND_URL in this script"
    echo "  - Database not initialized: Check PostgreSQL is running"
    echo "  - Missing Alert implementation: Check Backend/app/main.py has /alerts/sync endpoint"
    exit 1
fi
