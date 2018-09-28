var pg = new PGState("ws://localhost:8080/", "alexander", "alexander", "mypasswd");

pg.connect().then(() => {
    console.log("we're ready to query!");

    pg.simpleQuery("select random();").then((res) => {
	console.log("got a random:", res);
    }).catch((err) => {
	console.log("we got an error:", err);
    });

    pg.simpleQuery("select broken();").then((res) => {
	console.log("got a random:", res);
    }).catch((err) => {
	console.log("we got an error:", err);
    });

    pg.simpleQuery("select now();").then((res) => {
	console.log("got a time:", res);
    }).catch((err) => {
	console.log("we got an error:", err);
    });
});
