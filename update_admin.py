import bcrypt

# Generate a proper bcrypt hash for Admin@SOC2024!
hashed = bcrypt.hashpw(b'Admin@SOC2024!', bcrypt.gensalt()).decode('utf-8')

# Create the SQL statement safely
sql = f"UPDATE users SET hashed_password = '{hashed}' WHERE email = 'super@altisec.com';\n"

# Write to a file
with open('update_admin.sql', 'w') as f:
    f.write(sql)
print("SQL file generated successfully.")
