from neo4j import GraphDatabase
import os

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "password")

class GraphEngine:
    def __init__(self):
        try:
            self.driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        except Exception as e:
            print(f"Failed to connect to Neo4j: {e}")
            self.driver = None

    def close(self):
        if self.driver:
            self.driver.close()

    def update_identity_graph(self, user_id, device_id, ip_address):
        """Creates or updates nodes and links them."""
        if not self.driver or not user_id or not device_id:
            return

        query = """
        MERGE (u:User {id: $user_id})
        MERGE (d:Device {id: $device_id})
        MERGE (u)-[:LOGGED_IN_FROM]->(d)
        """
        
        if ip_address:
            query += """
            MERGE (i:IP {address: $ip_address})
            MERGE (d)-[:USED_IP]->(i)
            """

        try:
            with self.driver.session() as session:
                session.run(query, user_id=user_id, device_id=device_id, ip_address=ip_address)
        except Exception as e:
            print(f"Graph update error: {e}")

    def get_graph_risk(self, user_id, device_id):
        """Analyzes graph for suspicious patterns."""
        if not self.driver:
            return 0, []

        risk_score = 0
        reasons = []

        try:
            with self.driver.session() as session:
                # 1. Device used by many accounts (Referral Abuse/Device Farm)
                result = session.run("""
                MATCH (u:User)-[:LOGGED_IN_FROM]->(d:Device {id: $device_id})
                RETURN count(DISTINCT u) as account_count
                """, device_id=device_id)
                record = result.single()
                if record:
                    account_count = record["account_count"]
                    if account_count > 5:
                        risk_score += 50
                        reasons.append(f"Device linked to {account_count} accounts (Farm suspected)")
                    elif account_count > 2:
                        risk_score += 20
                        reasons.append(f"Device linked to {account_count} accounts (Account sharing)")

                # 2. Account used on many devices (Account Takeover)
                if user_id:
                    result = session.run("""
                    MATCH (u:User {id: $user_id})-[:LOGGED_IN_FROM]->(d:Device)
                    RETURN count(DISTINCT d) as device_count
                    """, user_id=user_id)
                    record = result.single()
                    if record:
                        device_count = record["device_count"]
                        if device_count > 3:
                            risk_score += 15
                            reasons.append(f"User active on {device_count} devices (ATO risk)")

        except Exception as e:
            print(f"Graph query error: {e}")

        return risk_score, reasons

# Singleton instance
graph_engine = GraphEngine()
