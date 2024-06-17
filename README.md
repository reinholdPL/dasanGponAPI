# Dasan Gpon Web API
Node.js web api for Dasan OLT using ssh as backend connection. Compatible with Dasan GPON OLT V5816, V5812G, and probably others, but only this two were tested.


#### Usage

Download ZIP or clone using git:

```
git clone https://github.com/reinholdPL/dasanGponAPI.git
```

Install dependencies and run script:
```
npm install
./index.js
```

#### Example credentials.json file

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