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

    var q1 = pg.extendedQuery("goonies");
    console.log("parsing");
    q1.parse("select $1")
      .then((res) => {
	  return q1.bind([], ["hey"], []);
      })
      .then((res) => {
	  return q1.execute();
      })
      .then((res) => {
	  console.log("got some results:", res);
      })
      .then(() => {
	  return q1.close("portal");
      })
      .then(() => {
	  return q1.bind([], ["you"], []);
      })
      .then((res) => {
	  return q1.execute();
      })
      .then((res) => {
	  console.log("got some results:", res);
      })
      .then(() => {
	  return q1.close("portal");
      })
      .then(() => {
	  return q1.bind([], ["guys"], []);
      })
      .then((res) => {
	  return q1.execute();
      })
      .then((res) => {
	  console.log("got some results:", res);
	  return pg.terminate();
      })
      .catch((err) => {
	  console.log("we got an error:", err);
      });

    var q2 = pg.extendedQuery("");
    q2.parse("select * from testing")
      .then((res) => {
	  return q2.bind();
      })
      .then((res) => {
	  return q2.execute(1);
      })
      .then((res) => {
	  console.log("got some results:", res);
	  return q2.execute(2);
      })
      .then((res) => {
	  console.log("got some results:", res);
      })
      .catch((err) => {
	  console.log("we got an error:", err);
	  pg.terminate();
      });
});
