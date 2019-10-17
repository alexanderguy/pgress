var formValue = function (id) {
    var ele = document.getElementById(id);

    return ele.value;
};

var execute = function () {
    var pg = new pgress.PGState(formValue("url"), formValue("db"), formValue("username"), formValue("password"));

    pg.connect().then(() => {
	console.log("we're ready to query!");

	pg.simpleQuery("select random();").then((res) => {
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
};
