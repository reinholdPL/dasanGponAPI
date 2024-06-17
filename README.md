# Dasan Gpon Web API
Node.js web api for Dasan OLT using ssh as backend connection.

#### example credentials.json file

```
{
    "hosts": {
        "192.168.5.30": {
            "port": 22,
            "username": "admin",
            "password": "qwerty"
        }
    }
}
```

Script will open SSH connection for every host in credentials.json file, and will mantain opened connection for runtime of the script. WEB API is running on port 8080 by default (configurable in config.json).