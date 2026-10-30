define(["exports","vue-router", "/src/menu/menudata.js"], function(exports, router, menudata){
    var menu = menudata.default;
    // console.log(menudata)
    var routes = [];
    var m = 0;
    // var originalPush = router.prototype.push;
    // router.prototype.push = function push(location) {
    //     try {
    //         return originalPush.call(this, location).catch(function(err){
    //             return err;
    //         })
    //     } catch(err){

    //     }
    // }

    for (var i=0; i<menu.length; i++)
    {
        var data = menu[i];
        if (data.children && data.children.length)
        {
            for (var j=0; j<data.children.length; j++)
            {
                var data2 = data.children[j];
                if (data2.children && data2.children.length)
                {
                    for (var n=0; n<data2.children.length; n++)
                    {
                        routes[m] = data2.children[n];
                        m++;
                    }
                }
                else
                {
                    routes[m] = data2;
                    m++;  
                }
            }
        }
        else
        {
            routes[m] = data;
            m++;
        }
    }

	var r = new router({
        mode:'hash',
        routes:routes
    });
	return r;
})