const express = require('express');
const fs = require('fs');
const nodemailer = require('nodemailer');
const handlebars = require('handlebars')
const cors = require('cors');
const sql = require('mssql');
const jwt = require('jsonwebtoken');
const app = express();
var tokenSecret = require('crypto').randomBytes(64).toString('hex')


app.use(cors());
app.use(express.json({limit: '100mb'}));

//credentials to log into database
var config = {
    user:'eclaim',
    password: 'Excm6745',
    server: '10.0.1.28',	
    driver: 'tedious',
    database: 'ECLAIM',
    options: {
        cryptoCredentialsDetails: {
            minVersion: 'TLSv1'
        },
        encrypt:false
    }
};


//Connect to database
sql.connect(config, function (err) {
    if (err) console.log(err);
    console.log("Connected!");
});

//port number that server is listening to
var port = process.env.port || process.env.PORT;
app.listen(port, () => {
	console.log(port)
})

//generating JWT token for user using email and password
function generateAccessToken(details) {
  return jwt.sign(details, tokenSecret, { expiresIn: '3600s' });
}

//checks for admin's token
async function authenticateAdmin(req, res, next) {
  const {token} = req.params
  if (token == null) return res.sendStatus(401)

  try {
    const decoded = jwt.verify(token, tokenSecret)
    var request = new sql.Request();
    const result = await request.query("SELECT COUNT(*) AS count FROM SystemAdmins WHERE email = '"+decoded.email+"' AND password = '"+decoded.password+"'")
    if(result.recordset[0].count != 1) return res.sendStatus(403)
    next()

  } catch(err) {
    if(err.name == 'TokenExpiredError') {
      return res.send({message: "Token expired!"})
    } else {
      console.log(err)
      return res.sendStatus(403)
    }
  }
} 


//User registers an account
app.post('/register', async (req, res) => {
  try {
    let email = req.body.companyEmail;
    let password = req.body.password;
    if(password == "") {

    }
    var request = new sql.Request();
    const check = await request.query("SELECT COUNT(*) AS count FROM Employees WHERE email = '"+email+"'")
    const count = await request.query("SELECT COUNT(*) AS count FROM Accounts WHERE email = '"+email+"'")
    if (check.recordset[0].count == 0) {
      return res.json({error: "known", message: "Email does not exist! Contact admin to add you as a user."})
    } else if (count.recordset[0].count == 1) {
      return res.json({error: "known", message: "Account already exists!"})
    } else {
      let statement = "INSERT INTO Accounts VALUES ('"+email+"','"+password+"', 'No')";
      await request.query(statement)
      res.json({user: email, userType: "Normal", message: "Account Created!"});
    }
  } catch(err) {
    console.log(err)
    res.json({error: "unknown", message: err.message});
  }  
});



//Load all users, departments and companies on admin home page
app.get('/admin/:token', authenticateAdmin, async (req, res) => {
  try {
    var request = new sql.Request();
    const users = await request.query('SELECT DISTINCT E.email, name, company_prefix, processor, E.approver, supervisor, approver_name, '
    + 'processor_email, locked FROM Employees E LEFT JOIN Accounts ON E.email = Accounts.email JOIN BelongsToDepartments B ON E.email = B.email JOIN Approvers A ON A.department = B.department'
    + ' JOIN Processors P ON E.company_prefix = P.company WHERE approver_name IS NULL OR (E.email != approver_name)')

    const departments = await request.query('SELECT department_name FROM Departments')
    const companies = await request.query('SELECT prefix FROM Companies')

    res.send({users: users.recordset, departments: departments.recordset, companies: companies.recordset});
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

});



//Load all departments that the user belongs to
app.get('/admin/editUser/:email/:token', authenticateAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    var request = new sql.Request();

    const rows = await request.query("SELECT department FROM BelongsToDepartments WHERE email = '"+email+"'")
    const result = await request.query("SELECT department FROM Approvers WHERE approver_name = '"+email+"'")
  
    res.send({dpts: rows.recordset, appDpts: result.recordset});

   } catch(err) {
    console.log(err)
    res.send({message: err.message});
   }

});


//Admin edits and updates user details
app.post('/admin/editUser/save', async (req, res) => {
  let name = req.body.name;
  let oldEmail = req.body.oldEmail;
  let newEmail = req.body.newEmail;
  let departments = req.body.department;
  let company = req.body.company;
  let isSupervisor = req.body.supervisor;
  let isApprover = req.body.approver;
  let isProcessor = req.body.processor;
  let approvingDepartments = req.body.approvingDepartments;

  var insertDpts = "";
  
  for(var i = 0; i < departments.length; i++) {
    if(i == departments.length - 1) {
      insertDpts += "('"+newEmail+"'," + "'"+departments[i]+"');";
    } else if (isApprover == 'No' && departments[i] == newEmail) {
      continue;
    } else {
      insertDpts += "('"+newEmail+"'," + "'"+departments[i]+"'),";
    }
  }

  var queryString = ""

  if(isApprover == 'No') {
    approvingDepartments = [];
    queryString = "UPDATE Approvers SET approver_name = null WHERE approver_name = '"+newEmail+"'";
  }

  if(isApprover == 'Yes') {
    for(var i = 0; i < approvingDepartments.length; i++) {
      queryString += "UPDATE Approvers SET approver_name = '"+newEmail+"' WHERE department = '"+approvingDepartments[i]+"'; "
    }
  }

  var request = new sql.Request();
  try{
      await request.query("SET XACT_ABORT ON " 
      + "BEGIN TRANSACTION "
      + "UPDATE Employees SET name = '"+name+"', company_prefix = '"+company+"', email = '"+newEmail+"', supervisor = '"+isSupervisor+"'"
      + ", approver = '"+isApprover+"', processor = '"+isProcessor+"' WHERE email = '"+oldEmail+"'"
      + "DELETE FROM BelongsToDepartments WHERE email = '"+newEmail+"'; "
        + "INSERT INTO BelongsToDepartments VALUES" + insertDpts
        + queryString + " COMMIT TRANSACTION");

      res.send({message: "User Updated!"})

  } catch(err) { 
    console.log(err)
    res.send({message: "Failed to update user!"});
  }
  
});



//Admin deletes user
app.post('/admin/deleteUser', async (req, res) => {
  let email = req.body.oldEmail;
  let approver = req.body.approver;
  var request = new sql.Request();
  try {


    await request.query("DELETE FROM Employees WHERE email = '"+email+"'")
    if(approver == 'Yes') {
      await request.query("DELETE FROM Departments WHERE department_name = '"+email+"'")
    }
  
  
    res.send({message: "User Deleted!"});
  
  } catch(err) {
    console.log(err)
    res.json({message: "Failed to delete user!"});
  }

});


//Admin locks user account
app.post('/admin/lockUser', async (req, res) => {
  let email = req.body.email;
  var request = new sql.Request();
  try {
    await request.query("UPDATE Accounts SET locked = 'Yes' WHERE email = '"+email+"'")
    res.send({message: "User Locked!"});
  } catch(err) {
    console.log(err)
    res.json({message: err.message});
  }
})

//Admin unlocks user account
app.post('/admin/unlockUser', async (req, res) => {
  let email = req.body.email;
  var request = new sql.Request();
  try {
    await request.query("UPDATE Accounts SET locked = 'No' WHERE email = '"+email+"'")
    res.send({message: "User Unlocked!"});
  } catch(err) {
    console.log(err)
    res.json({message: err.message});
  }
})


//Admin adds user 
app.post('/admin/addUser', async (req, res) => {
  let name = req.body.name;
  let email = req.body.email;
  let company = req.body.company;
  let departments = req.body.department;
  let isSupervisor = req.body.isSupervisor;
  let isApprover = req.body.isApprover;
  let isProcessor = req.body.isProcessor;
  let approvingDepartments = req.body.approving;

  try {
    var request = new sql.Request();
    const query = "INSERT INTO Employees VALUES(@email, @name, @company," +
    "@isProcessor, @isApprover, @isSupervisor, @profile)"

    request.input('email', sql.VarChar, email)
    request.input('name', sql.VarChar, name)
    request.input('company', sql.VarChar, company)
    request.input('isProcessor', sql.VarChar, isProcessor)
    request.input('isApprover', sql.VarChar, isApprover)
    request.input('isSupervisor', sql.VarChar, isSupervisor)
    request.input('profile', sql.VarChar, null)
    await request.query(query)
    
    for(var i = 0; i < departments.length; i++) {
      request.query("INSERT INTO BelongsToDepartments VALUES('"+email+"','"+departments[i]+"')")
    }
    
    if(approvingDepartments != null) {
      for(var i = 0; i < approvingDepartments.length; i++) {
        request.query("UPDATE Approvers SET approver_name = '"+email+"' WHERE department = '"+approvingDepartments[i]+"'")
      }
    }
    
      res.send({email: email, departments: departments, message: "User Added!"})
    
  } catch(err) {
      console.log(err)
      res.json({message: "Failed to add user!"});
  }
});




//User login to app
app.post('/login', async (req, res) => {
  try {
    
    let email = req.body.companyEmail;
    let password = req.body.password;
    var request = new sql.Request();
    
    let checkAdmin = await request.query("SELECT COUNT(*) AS count FROM SystemAdmins WHERE email = '"+email+"' and password = '"+password+"'");
    let count = checkAdmin.recordset[0].count;
    

    //Admin login
    if (count == 1) {
      const token = generateAccessToken({ email: email, password: password });
      res.send({ email: email, userType: "Admin", token: token, message: "Login Successful!"});	

    } else {

      let user = await request.query("SELECT COUNT(*) AS count FROM Accounts WHERE email = '"+email+"' AND password = '"+password+"'")
      
      if(user.recordset[0].count == 0) {
        return res.json({error: "known", message: 'Invalid email and/or password!'})
      }

      let locked = await request.query("SELECT locked FROM Accounts WHERE email = '"+email+"' and password = '"+password+"'")
      
      if(locked.recordset[0].locked == 'Yes') {
       return res.json({error: "known", message: 'Account is locked!'})
      }

      let statement = "SELECT COUNT(*) AS count FROM Accounts WHERE email = '"+email+"' and password = '"+password+"' and locked = 'No'";
      const result = await request.query(statement)
      let count = result.recordset[0].count;

      //Normal user login  
      if(count == 1) {
        
        const result = await request.query('SELECT DISTINCT E.email, name, company_prefix, processor, E.approver, supervisor, approver_name, password, '
        + 'processor_email, profile FROM Employees E JOIN BelongsToDepartments B ON E.email = B.email JOIN Approvers A ON A.department = B.department'
        + " JOIN Processors P ON E.company_prefix = P.company JOIN Accounts ON Accounts.email = E.email WHERE E.email = '"+email+"'");

        let records = result.recordset[0];
       
        const token = generateAccessToken({ email: email, password: password });
        console.log("Login: " + token)
        
        res.send({userType: "Normal", image: records.profile, email: records.email, name: records.name, token: token, message: "Login Successful!", details: records});
      } else {
        return res.json({error: "known", message: "Invalid email and/or password!"});
      }
    }
} catch(err) {
    console.log(err)
    res.json({error: "unknown", message: err.message});
}
});


//generate random form ID for claim
const generateRandomID = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';

  for (let i = 0; i < 8; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    id += characters[randomIndex];
  }

  return id;
};

//get all of the cost centres from database
app.get('/getCostCentres', async (req, res) => {
  try {
    var request = new sql.Request();
    const result = await request.query("SELECT * FROM CostCentres")
    res.send(result.recordset)
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }
})

//get all the people that a user can claim under for expense
app.get('/getClaimants/:id/:token', async (req, res) => {
  
  const { id, token } = req.params;

  try {
    const decoded = jwt.verify(token, tokenSecret)
    var request = new sql.Request();
    const findFormCreator = await request.query("SELECT form_creator FROM Claims WHERE id = '"+id+"'")
    const formCreator = findFormCreator.recordset[0].form_creator
    //find supervisor of form creator
    const checkSupervisor = await request.query("SELECT S.supervisor FROM Claims C JOIN BelongsToDepartments B ON C.form_creator = B.email JOIN Supervisors S ON S.department = B.department WHERE C.id = '"+id+"'")
    const supervisor = checkSupervisor.recordset[0].supervisor
    const getClaimants = await request.query("SELECT DISTINCT email FROM BelongsToDepartments WHERE department IN (SELECT department FROM BelongsToDepartments WHERE email = '"+formCreator+"')")
    //supervisor created the form
    if(supervisor == formCreator) {
      const password = await request.query("SELECT password FROM Accounts WHERE email = '"+supervisor+"'")
      //authenticated
      if(supervisor == decoded.email && decoded.password == password.recordset[0].password) {
        return res.send(getClaimants.recordset)
      }
    //someone else in the department created it(normal/approver)
    } else {
      const password = await request.query("SELECT password FROM Accounts WHERE email = '"+decoded.email+"'")
      if(decoded.email == formCreator && decoded.password == password.recordset[0].password) {
        res.send([{email: decoded.email}])
      } else {
        res.sendStatus(403)
      }
    }

  } catch(err) {
    if(err.name == 'TokenExpiredError') {
      return res.send({error: 'true', message: "Token expired!"})
    } else {
      console.log(err)
      return res.send({error: 'true', message: err.message})
    }
  }
})



//User adds a new claim
app.post('/addClaim', async (req, res) => {
  let formCreator = req.body.creator;
  let expenseType = req.body.expenseType;
 
  var request = new sql.Request();

  let payPeriodFrom = req.body.payPeriodFrom;
  let payPeriodTo = req.body.payPeriodTo;
  let company = req.body.company;
  let costCenter = req.body.costCenter;
  if (costCenter == "") {
    costCenter = null;
  }

  var newFormId = '';

  while (newFormId == '') {
    const id = generateRandomID();
    const checkId = await request.query("SELECT COUNT(*) AS count FROM Claims WHERE id = '"+id+"'");
    let count = checkId.recordset[0].count;
    if(count == 0) {
      newFormId = id;
    }
  }

  //Adding monthly claim
  if (expenseType == "Monthly") {
    try {
      if(payPeriodFrom > payPeriodTo) {
        return res.json({error: "known", message: "Pay Period(From) cannot be later than Pay Period(To)!"})
      }
      const fromDate = await request.query("SELECT PARSE('"+payPeriodFrom+"' as date USING 'AR-LB') AS fromDate")
      const toDate = await request.query("SELECT PARSE('"+payPeriodTo+"' as date USING 'AR-LB') AS toDate")
      const checkApproval = await request.query("SELECT levels_of_approval FROM Departments WHERE department_name != '"+formCreator+"' AND department_name IN (SELECT department FROM BelongsToDepartments WHERE email = '"+formCreator+"')")

      const query = "SET XACT_ABORT ON " 
      + "BEGIN TRANSACTION "
      +"INSERT INTO Claims VALUES('"+newFormId+"', @total_amount, @formCreator, @expense_type, "
        + "@levels, @claimees, @status, @sd, @ad, @pd, @rd, GETDATE(), @nextApprover, '"+company+"');"
        + "INSERT INTO MonthlyGeneral VALUES('"+newFormId+"', @fromDate, @toDate, @costCenter);"
        + " COMMIT TRANSACTION";
      request.input('expense_type', sql.Text, expenseType)
      request.input('total_amount', sql.Money, 0);
      request.input('formCreator', sql.VarChar, formCreator);
      request.input('levels', sql.Int, checkApproval.recordset[0].levels_of_approval);
      request.input('claimees', sql.Int, 1);
      request.input('status', sql.VarChar, "In Progress");
      request.input('sd', sql.DateTime, null);
      request.input('ad', sql.DateTime, null);
      request.input('pd', sql.DateTime, null);
      request.input('rd', sql.DateTime, null);
      request.input('nextApprover', sql.VarChar, null);
      request.input('fromDate', sql.Date, fromDate.recordset[0].fromDate);
      request.input('toDate', sql.Date, toDate.recordset[0].toDate);
      request.input('costCenter', sql.VarChar, costCenter)

      await request.query(query);

      const dateTime = await request.query("SELECT creation_date FROM Claims WHERE id = '"+newFormId+"'")

      const history = "INSERT INTO History VALUES('"+newFormId+"', 'Created', @datetime, '"+formCreator+"')"
      request.input('datetime', sql.DateTime, dateTime.recordset[0].creation_date);
      await request.query(history);
    
      res.send({message: "Monthly claim added successfully!", user: formCreator});
          
    } catch(err) {
      console.log(err)
      res.send({error: "unknown", message: err.message});
    }

//Adding travelling claim
} else {

  try {
    let country = req.body.country;
    let exchangeRate = req.body.exchangeRate;
    let dateFrom = req.body.dateFrom;
    let dateTo = req.body.dateTo;

    var request = new sql.Request();

    if(country == null || exchangeRate == null || country == "" || exchangeRate == "") {
      return res.json({error: "known", message: "Please fill in all the fields!"})
    }

    const fromDate = await request.query("SELECT PARSE('"+dateFrom+"' as date USING 'AR-LB') AS fromDate")
    const toDate = await request.query("SELECT PARSE('"+dateTo+"' as date USING 'AR-LB') AS toDate")
    
    if(fromDate.recordset[0].fromDate > toDate.recordset[0].toDate) {
      return res.json({error: "known", message: "Date(From) cannot be later than Date(To)!"})
    }

    const checkApproval = await request.query("SELECT levels_of_approval FROM Departments WHERE department_name != '"+formCreator+"' AND department_name IN (SELECT department FROM BelongsToDepartments WHERE email = '"+formCreator+"')")
    
    const query = "SET XACT_ABORT ON BEGIN TRANSACTION " 
    + " INSERT INTO Claims VALUES('"+newFormId+"', @total_amount, '"+formCreator+"', @expense_type, @levels, @claimees, 'In Progress', @sd, @ad, @pd, @rd, GETDATE(), @nextApprover, '"+company+"');"
    + "INSERT INTO TravellingGeneral VALUES('"+country+"', "+exchangeRate+", @period_from, @period_to, '"+newFormId+"'); COMMIT TRANSACTION";
        
    request.input('expense_type', sql.Text, expenseType)
    request.input('total_amount', sql.Money, 0);
    request.input('levels', sql.Int, checkApproval.recordset[0].levels_of_approval);
    request.input('claimees', sql.Int, 1);
    request.input('sd', sql.DateTime, null);
    request.input('ad', sql.DateTime, null);
    request.input('pd', sql.DateTime, null);
    request.input('rd', sql.DateTime, null);
    request.input('nextApprover', sql.VarChar, null);
    request.input('period_from', sql.Date, fromDate.recordset[0].fromDate);
    request.input('period_to', sql.Date, toDate.recordset[0].toDate);

    await request.query(query);

    const dateTime = await request.query("SELECT creation_date FROM Claims WHERE id = '"+newFormId+"'")

    const history = "INSERT INTO History VALUES('"+newFormId+"', 'Created', @datetime, '"+formCreator+"')"
    request.input('datetime', sql.DateTime, dateTime.recordset[0].creation_date);
    await request.query(history);

    res.send({message: "Travelling claim added successfully!", user: formCreator});

  } catch(err) {
      console.log(err)
      res.send({error: "unknown", message: err.message});
  }

  }
});


//User joins an existing claim
app.post('/joinClaim', async (req, res) => {
  let formId = req.body.formId;
  let formCreator = req.body.creator; //user

  try {
    var request = new sql.Request();
    const claimExists = await request.query("SELECT COUNT(*) AS count FROM Claims WHERE id = '"+formId+"'")
    if (claimExists.recordset[0].count == 0) {
      return res.json({error: "known", message: "Claim does not exist!"})
    }
    const results = await request.query("SELECT form_type, form_creator FROM Claims WHERE id = '"+formId+"'")

    if(results.recordset[0].form_type == "Travelling") {
      return res.json({error: "known", message: "Travelling claims cannot be joined!"})
    } else {
      //Check same department and form_creator is supervisor
      const form_creator = results.recordset[0].form_creator
      const query = "SELECT COUNT(*) AS count FROM BelongsToDepartments WHERE email = '"+formCreator+"' AND department IN (SELECT department FROM Supervisors WHERE supervisor = '"+form_creator+"')"
      const check = await request.query(query)
      if(check.recordset[0].count == 0) {
        return res.json({error: "known", message: "This is not your supervisor's form!"})
      }
    }
    //handles case where form creator joins claim as it will throw error
    const claimCreator = await request.query("SELECT form_creator FROM Claims WHERE id = '"+formId+"'")
    if(claimCreator.recordset[0].form_creator == formCreator) {
      return res.json({error: "known", message: "You cannot join your own claim!"})
    }

    //handles case where claimant joins before and joins again
    const check = await request.query("SELECT COUNT(*) AS count FROM Claimees WHERE claimee = '"+formCreator+"' AND form_id = '"+formId+"'")
    if(check.recordset[0].count == 0) {
      await request.query("INSERT INTO Claimees VALUES('"+formId+"', '"+formCreator+"')");
    } else if (check.recordset[0].count == 1) {
      return res.json({error: "known", message: "You have already joined this claim!"})
    }
    res.send({message: "Joined claim successfully!", user: formCreator})

  } catch(err) {
    console.log(err)
    res.send({error: "unknown", message: err.message});
  }

});


//Add or change profile photo
app.post('/uploadImage', async (req, res) => {
  try {
    let email = req.body.email;
    let image = req.body.image;


    var request = new sql.Request();
    const query = "UPDATE Employees SET profile = @image WHERE email = '"+email+"'"
    request.input('image', sql.VarChar, image)
    await request.query(query);
    
    res.send({error:false, message: "Image updated successfully!"});


  } catch (err) {
    console.log(err)
    res.send({error:true, message: "Failed to upload image!"});
  }

});

//checks for correct user's token
async function authenticateUser(req, res, next) {
  const {email, token} = req.params
  if (token == null) return res.sendStatus(401)

  try {
    const decoded = jwt.verify(token, tokenSecret)
    var request = new sql.Request();
    const password = await request.query("SELECT password FROM Accounts WHERE email = '"+decoded.email+"'")

    if(decoded.email != email || decoded.password != password.recordset[0].password) return res.sendStatus(403)
    next()

  } catch(err) {
    if(err.name == 'TokenExpiredError') {
      return res.send({message: "Token expired!"})
    } else {
      console.log(err)
      return res.sendStatus(403)
    }
  }
} 


//Load all user's claims on MyClaims page
app.get('/myClaims/:email/:token', authenticateUser, async (req, res) => {
  try {
    const { email } = req.params;
    
    var request = new sql.Request();
  
    const queryString = 'SELECT C.id, form_creator, total_amount, claimees, status, form_type, pay_period_from, pay_period_to,'
    + 'period_from, period_to FROM Claims C LEFT OUTER JOIN MonthlyGeneral M ON C.id = M.id LEFT OUTER JOIN TravellingGeneral T ON C.id = T.id' 
    + ' JOIN Claimees ON C.id = Claimees.form_id WHERE claimee = @email ORDER BY creation_date DESC';

    request.input('email', sql.VarChar, email);
    const result = await request.query(queryString);
    res.send(result.recordset);

  } catch(err) {
      console.log(err)
      res.send({message: err.message});
  }

});

//grants access to those allowed to see the expenses
async function expenseAuthentication (req, res, next) {
  const {id, token} = req.params
  if (token == null) return res.sendStatus(401)

  try {
    const decoded = jwt.verify(token, tokenSecret)
    var request = new sql.Request();
    const status = await request.query("SELECT status FROM Claims WHERE id = '"+id+"'")
    const claimees = await request.query("SELECT claimee from Claimees WHERE form_id = '"+id+"'")
    const checkFormCreator = await request.query("SELECT COUNT(*) AS count FROM Approvers WHERE approver_name = (SELECT form_creator FROM Claims WHERE id = '"+id+"')")
    var firstApprover;

    //form creator is an approver
    if(checkFormCreator.recordset[0].count >= 1) {
      firstApprover = await request.query("SELECT approver_name FROM Approvers WHERE department = (SELECT form_creator FROM Claims WHERE id = '"+id+"')")
    } else {
      //form creator is not an approver, find first approver of form creator
      firstApprover = await request.query("SELECT approver_name FROM Approvers WHERE department = (SELECT department FROM BelongsToDepartments WHERE email = (SELECT form_creator FROM Claims WHERE id = '"+id+"'))")
    }
    

    var nextApprover;
    const findProcessor = await request.query("SELECT processor_email FROM Processors where company = (SELECT company_prefix FROM Employees WHERE email = (SELECT form_creator FROM Claims WHERE id = '"+id+"'))")
    var processor = findProcessor.recordset[0].processor_email
    const involved = await request.query("SELECT COUNT(*) AS count FROM History WHERE id = '"+id+"' AND person = '"+decoded.email+"'")

    for (var i = 0; i < claimees.recordset.length; i++) {
      if(claimees.recordset[i].claimee == decoded.email) {
        return next()
      }
    }

    if(involved.recordset[0].count >= 1) {
      return next()
    }

    if(status.recordset[0].status == 'Submitted') {
      //check for first approver
      if(firstApprover.recordset[0].approver_name == decoded.email) {
        return next()
      }
    } else if (status.recordset[0].status == 'Approved') {
      if(processor == decoded.email) {
        return next()
      }
    } else if (status.recordset[0].status == "Pending Next Approval") {
      const next_Approver = await request.query("SELECT next_recipient FROM Claims WHERE id = '"+id+"'")
      nextApprover = next_Approver.recordset[0].next_recipient
      if(nextApprover == decoded.email) {
        return next()
      }
    } 
    
  } catch(err) {
    if(err.name == 'TokenExpiredError') {
      return res.send({message: "Token expired!"})
    } else {
      console.log(err)
      return res.sendStatus(403)
    }
  }
} 


//get expenses for claim
app.get('/getExpenses/:user/:id/:token', expenseAuthentication, async (req, res) => {
  const { id, user } = req.params;
  var request = new sql.Request();

  try {
    //Check who is form creator
    const query = "SELECT form_creator FROM Claims WHERE id = '"+id+"'";
    const form_creator = await request.query(query)

    
    //Form creator is not user
    if (form_creator.recordset[0].form_creator != user) {
      const queryString = "SELECT * FROM Expenses Ex JOIN Employees E ON Ex.claimee = E.email WHERE id = '"+id+"' AND claimee = '"+user+"' ORDER BY item_number ASC";
      const result = await request.query(queryString);
      res.send(result.recordset);

    //display all expenses
    } else {
      const queryString = "SELECT * FROM Expenses Ex JOIN Employees E ON Ex.claimee = E.email WHERE id = '"+id+"' ORDER BY item_number ASC";
      const result = await request.query(queryString);
      res.send(result.recordset);
    }
    
  
  } catch(err) {
    console.log(err.message)
    res.send({message: err.message});
  }

});



//Add travelling expense
app.post('/addTravellingExpense', async (req, res) => {
  let id = req.body.id;
  let claimee = req.body.claimee;
  let amount = req.body.amount;
  let type = req.body.type;
  let place = req.body.place;
  let customer = req.body.customer_name;
  let company = req.body.company;
  let otherType = req.body.otherType;
  let file_data = req.body.file_data;
  let file_name = req.body.file_name;

  try {

    if(type == null) {
      return res.json({error: "known", message: "Please enter a valid expense type!"})
    }

    if(type == "Others") {

      if(otherType == "") {
        otherType = null;
      }

      if(otherType == "Others") {
        return res.json({error: "known", message: "Please enter a valid expense type!"})
      }

      type = otherType;
    }

    if(!/^\d+(\.\d{2})?$/.test(amount)) {
      return res.send({error: "known", message: "Please enter a valid amount!"})
    }

    let date = req.body.date;
    var description = req.body.description;

    if(description == "") {
      description = null;
    }

    
    var request = new sql.Request();
    
    const count = await request.query("SELECT COALESCE(MAX(item_number), 0) AS count FROM Expenses WHERE id = '"+id+"' AND claimee = '"+claimee+"'")
    let item_number = count.recordset[0].count + 1;
    const expense_date = await request.query("SELECT PARSE('"+date+"' as date USING 'AR-LB') AS date")
    const query = ("INSERT INTO Expenses VALUES('"+id+"', '"+claimee+"', @count, '"+type+"', @date, @place, @customer, @company, "
     + "@withGst, @gst, @withoutGst, @amount, @description, @receipt, @file_name, 'Yes', GETDATE(), GETDATE())");
    request.input('count', sql.Int, item_number);
    request.input('date', sql.Date, expense_date.recordset[0].date)
    
    if(place == "" || place == null) {
      request.input('place', sql.VarChar, null);
    } else {
      request.input('place', sql.VarChar, place);
    }
    if(customer == "" || customer == null) {
      request.input('customer', sql.VarChar, null);
    } else {
      request.input('customer', sql.VarChar, customer);
    }
    if(company == "" || company == null) {
      request.input('company', sql.VarChar, null);
    } else {
      request.input('company', sql.VarChar, company);
    }
    request.input('withGst', sql.Money, null);
    request.input('gst', sql.Money, null);
    request.input('withoutGst', sql.Money, null);
    request.input('amount', sql.Money, amount);
    request.input('description', sql.Text, description);
    if(file_data == null) {
      request.input('receipt', sql.VarBinary, null);
    } else {
      request.input('receipt', sql.VarBinary, Buffer.from(file_data));
    }

    if(file_name == null) {
      request.input('file_name', sql.VarChar, null);
    } else {
      request.input('file_name', sql.VarChar, file_name);
    }

    await request.query(query);

    res.send({message: "Success!"});
  } catch(err) {
    console.log(err)
    res.send({error: "unknown", message: err.message});
  }

});


//Add monthly expense
app.post('/addMonthlyExpense', async (req, res) => {
  let id = req.body.id;
  let claimee = req.body.claimee;
  let place = req.body.place;
  let adder = req.body.adder;
  let customer_name = req.body.customer_name;
  let company = req.body.company;
  let type = req.body.type;
  let otherType = req.body.otherType;
  let date = req.body.date;
  var description = req.body.description;
  let file_name = req.body.file_name;
  let file_data = req.body.file_data;
  let checked = 'No'
  let amount = req.body.amount;
  let isSelected = req.body.isSelected;

  try {
    var request = new sql.Request();
    var tax_base = null;
    var gst_amount = null;
    const rate = await request.query("SELECT rate FROM GST")
    const gst = rate.recordset[0].rate;

    if(amount == '' || amount == null) {
      return res.send({error: "known", message: "Please fill in the amount!"})
    } else {
      if(!/^\d+(\.\d{2})?$/.test(amount)) {
          return res.send({error: "known", message: "Please enter a valid amount!"})
      } else {
        if(isSelected == true) {
          //calculate tax base and gst amount
          tax_base = parseFloat(amount * (1 - gst/100)).toFixed(2);
          gst_amount = parseFloat(amount * gst / 100).toFixed(2);
        }
      }
    } 

    if(type == null) {
      return res.send({error: "known", message: "Please select an expense type!"})
    }

    if(type == "Others") {

      if(otherType == "") {
        otherType = null;
      }

      if(otherType == "Others") {
        return res.send({error: "known", message: "Please enter a valid expense type!"})
      }
      type = otherType;
    }

    if(description == "") {
      description = null;
    }

    if(place == "") {
      place = null;
    }

    if(customer_name == "") {
      customer_name = null;
    }

    if(company == "") {
      company = null;
    }
    
    const count = await request.query("SELECT COALESCE(MAX(item_number), 0) AS count FROM Expenses WHERE id = '"+id+"'")
    let item_number = count.recordset[0].count + 1;
    const expense_date = await request.query("SELECT PARSE('"+date+"' as date USING 'AR-LB') AS date")
    const form_creator = await request.query("SELECT form_creator FROM Claims WHERE id = '"+id+"'")
    if(adder == form_creator.recordset[0].form_creator) {
      checked = 'Yes'
    } 
    
    if(claimee != form_creator.recordset[0].form_creator) {
      const check = await request.query("SELECT COUNT(*) AS count FROM Claimees WHERE claimee = '"+claimee+"' AND form_id = '"+id+"'")
      if(check.recordset[0].count == 0) {
        await request.query("INSERT INTO Claimees VALUES('"+id+"', '"+claimee+"')")
      }
    }
    const query = ("INSERT INTO Expenses VALUES('"+id+"', '"+claimee+"', @count, '"+type+"', @date, @place, @customer, @company, "
    + "@tax_base, @gst_amount, @without_gst, "+parseFloat(amount)+", @description, @receipt, @file_name, @checked, GETDATE(), GETDATE() )");
    
    request.input('count', sql.Int, item_number);
    request.input('date', sql.Date, expense_date.recordset[0].date)
    request.input('place', sql.VarChar, place);
    request.input('customer', sql.VarChar, customer_name);
    request.input('company', sql.VarChar, company);
    request.input('tax_base', sql.Money, tax_base);
    request.input('gst_amount', sql.Money, gst_amount);
    if(isSelected == true) {
      request.input('without_gst', sql.Money, null);
    } else {
      request.input('without_gst', sql.Money, parseFloat(amount));
    }
    request.input('description', sql.Text, description);
    if(file_data == null) {
      request.input('receipt', sql.VarBinary, null);
    } else {
      request.input('receipt', sql.VarBinary, Buffer.from(file_data));
    }

    if(file_name == null) {
      request.input('file_name', sql.VarChar, null);
    } else {
      request.input('file_name', sql.VarChar, file_name);
    }
    request.input('checked', sql.VarChar, checked)

    await request.query(query);

    res.send({message: "Success!"});
  } catch(err) {
    console.log(err)
    res.send({error: "unknown", message: err.message});
  }

});




//Get travelling expense types from database
app.get('/getTravellingExpenseTypes', async (req, res) => {
  try {
    
    var request = new sql.Request();
    const result = await request.query("SELECT * FROM TravellingExpenseTypes");
    res.send(result.recordset);
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

});


//Get monthly expense types from database
app.get('/getMonthlyExpenseTypes', async (req, res) => {
  try {
    
    var request = new sql.Request();
    const result = await request.query("SELECT * FROM MonthlyExpenseTypes");
    res.send(result.recordset);
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

});



//User edits travelling expense
app.post('/editTravellingExpense', async (req, res) => {
  let id = req.body.id;
  let claimee = req.body.claimee;
  let item_number = req.body.item_number;
  let amount = req.body.amount;
  let place = req.body.place;
  let customer = req.body.customer_name;
  let company = req.body.company;
  let type = req.body.type;
  let otherType = req.body.otherType;
  let date = req.body.date;
  let file_data = req.body.file_data;
  let file_name = req.body.file_name;
  let description = req.body.description;
     
  
  try{

    var request = new sql.Request();

    if(type == null) {
      return res.json({error: "known", message: "Please enter a valid expense type!"})
    }

    if(type != "Entertainment and Gifts") {
      place = null
      customer = null
      company = null
    }

    if(type == "Others") {

      if(otherType == "") {
        otherType = null;
      }

      if(otherType == "Others") {
        return res.json({error: "known", message: "Please enter a valid expense type!"})
      }

      type = otherType;
    }

    if(!/^\d+(\.\d{2})?$/.test(amount)) {
      return res.send({error: "known", message: "Please enter a valid amount!"})
    }

    if(description == "") {
      description = null;
    }
   
    const expense_date = await request.query("SELECT PARSE('"+date+"' as date USING 'AR-LB') AS date")
    const query = "UPDATE Expenses SET expense_type = '"+type+"', date_of_expense = @date, "
    + "description = @description, total_amount = @amount, receipt = @receipt, file_name = @file_name, place = @place, customer_name = @customer, company_name = @company, last_modified = GETDATE() WHERE id = '"+id+"'"
    + " AND claimee = '"+claimee+"' AND item_number = @item_number";

    request.input('date', sql.Date, expense_date.recordset[0].date);
    if (description == null) {
      request.input('description', sql.VarChar, null)
      } else {
      request.input('description', sql.VarChar, description)
    }

    request.input('amount', sql.Money, amount);

    if(file_data == null) {
      request.input('receipt', sql.VarBinary, null);
    } else {
      request.input('receipt', sql.VarBinary, Buffer.from(file_data));
    }

    if(file_name == null) {
      request.input('file_name', sql.VarChar, null);
    } else {
      request.input('file_name', sql.VarChar, file_name);
    }

    request.input('place', sql.VarChar, place);
    request.input('customer', sql.VarChar, customer);
    request.input('company', sql.VarChar, company);
    request.input('item_number', sql.Int, item_number);
    
    await request.query(query)
    res.send({message: "Expense updated!"})

  } catch(err) { 
    console.log(err)
    res.send({error: "unknown", message: err.message});
  }
});




//User edits monthly expense
app.post('/editMonthlyExpense', async (req, res) => {
  let id = req.body.id;
  let claimee = req.body.claimee;
  let item_number = req.body.item_number;
  let type = req.body.type;
  let place = req.body.place;
  let customer = req.body.customer;
  let company = req.body.company;
  let otherType = req.body.otherType;
  let date = req.body.date;
  let description = req.body.description;
  let file_data = req.body.file_data;
  let file_name = req.body.file_name;
  let checked = 'No';
  let isSelected = req.body.isSelected;
  let amount = req.body.amount;
    
  
  try{
    var request = new sql.Request();
    var tax_base = null;
    var gst_amount = null;
    const rate = await request.query("SELECT rate FROM GST");
    const gst = rate.recordset[0].rate

    if(amount == '' || amount == null) {
      return res.send({error: "known", message: "Please fill in the amount!"})
    } else {
      if(!/^\d+(\.\d{2})?$/.test(amount)) {
          return res.send({error: "known", message: "Please enter a valid amount!"})
      } else {
        if(isSelected == true) {
          tax_base = parseFloat(amount * (1 - gst/100)).toFixed(2);
          gst_amount = parseFloat(amount * (gst/100)).toFixed(2);
        }
      }
    } 

    

    if(type == null) {
      return res.send({error: "known", message: "Please select an expense type!"})
    }

    if(type != "Entertainment and Gifts") {
      place = null
      customer = null
      company = null
    }

    if(type == "Others") {

      if(otherType == "") {
        otherType = null;
      }

      if(otherType == "Others") {
        return res.send({error: "known", message: "Please enter a valid expense type!"})
      }

      type = otherType;
    }

    if(description == "") {
      description = null;
    }
    
    const expense_date = await request.query("SELECT PARSE('"+date+"' as date USING 'AR-LB') AS date")
    
    const form_creator = await request.query("SELECT form_creator FROM Claims where id = '"+id+"'")
    if(form_creator.recordset[0].form_creator == claimee) {
      checked = 'Yes'
    }

  

    const query = "UPDATE Expenses SET expense_type = '"+type+"', date_of_expense = @date, "
    + "description = @description, total_amount = "+parseFloat(amount)+", receipt = @receipt, file_name = @file_name, last_modified = GETDATE(), place = @place, customer_name = @customer,"
    + " company_name = @company, amount_with_gst = @tax_base, gst_amount = @gst_amount, amount_without_gst = @without_GST, checked = '"+checked+"' WHERE id = '"+id+"'"
    + " AND claimee = '"+claimee+"' AND item_number = "+item_number+"";

    request.input('date', sql.Date, expense_date.recordset[0].date);
    if (description == null) {
      request.input('description', sql.VarChar, null)
      } else {
      request.input('description', sql.VarChar, description)
    }
    if(file_data == null) {
      request.input('receipt', sql.VarBinary, null);
    } else {
      request.input('receipt', sql.VarBinary, Buffer.from(file_data));
    }
    if(file_name == null) {
      request.input('file_name', sql.VarChar, null);
    } else {
      request.input('file_name', sql.VarChar, file_name);
    }
    request.input('place', sql.VarChar, place);
    request.input('customer', sql.VarChar, customer);
    request.input('company', sql.VarChar, company);
    request.input('tax_base', sql.Money, tax_base);
    request.input('gst_amount', sql.Money, gst_amount);
    if(isSelected == true) {
      request.input('without_gst', sql.Money, null);
    } else {
      request.input('without_gst', sql.Money, parseFloat(amount));
    }
    
    await request.query(query)
    res.send({message: "Expense updated!"})

  } catch(err) { 
    console.log(err)
    res.send({error: "unknown", message: err.message});
  }
  
});


//Delete expense
app.post('/deleteExpense', async (req, res) => {
  let id = req.body.id;
  let claimee = req.body.claimee;
  let item_number = req.body.item_number;

  try {
    var request = new sql.Request();
    const query = "DELETE FROM Expenses WHERE id = '"+id+"' AND claimee = '"+claimee+"' AND item_number = "+item_number+"";
    await request.query(query);
    res.send({message: "Expense deleted!"})
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

});



//Delete claim
app.post('/deleteClaim', async (req, res) => {
  
  let id = req.body.current.id;
  let form_creator = req.body.current.form_creator;

  try {
    var request = new sql.Request();
    const query = "SET XACT_ABORT ON BEGIN TRANSACTION DELETE FROM Claims WHERE id = '"+id+"'; DELETE FROM Claimees WHERE form_id = '"+id+"'; COMMIT TRANSACTION";
    await request.query(query);
    const history = "INSERT INTO History VALUES('"+id+"', 'Deleted', GETDATE(), '"+form_creator+"')"	
    await request.query(history);
    res.send({message: "Claim deleted!"})
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

});


//Supervisor checks expense after clicking to view it
app.post('/checkExpense', async (req, res) => {
  let id = req.body.id;
  let claimee = req.body.claimee;
  let item_number = req.body.item_number;

  try {
    var request = new sql.Request();
    const query = "UPDATE Expenses SET checked = 'Yes' WHERE id = '"+id+"' AND claimee = '"+claimee+"' AND item_number = "+item_number+"";
    await request.query(query);
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }
});


const sendEmailWithRetry = async (transporter, mailOptions, delay, maxRetries) => {
  return new Promise((resolve, reject) => {
    let retryCount = 0;

    const sendEmail = () => {
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`Error sending email. Retrying attempt ${retryCount}/${maxRetries}...`);
            setTimeout(sendEmail, delay);
          } else {
            reject(error);
          }
        } else {
          resolve(info);
        }
      });
    };

    sendEmail();
  });
};


//Form creator submits claim
app.post('/submitClaim', async (req, res) => {
  let id = req.body.claim.current.id;
  let form_creator = req.body.claim.current.form_creator;
  let type = req.body.claim.current.form_type;
  let total_amount = req.body.claim.current.total_amount
  let period = req.body.parsedDate

  try {
    var request = new sql.Request();
    
    const emptyClaim = await request.query("SELECT COUNT(*) AS count FROM Expenses WHERE id = '"+id+"'")
    if(emptyClaim.recordset[0].count == 0) {
      return res.json({error: "known", message: "Please add at least one expense!"})
    }
    
    const result = await request.query("SELECT COUNT(*) AS count FROM Expenses WHERE id = '"+id+"' AND checked = 'No'")
    if(result.recordset[0].count == 0) {
      
      const updateStatus = "UPDATE Claims SET status = 'Submitted', submission_date = GETDATE() WHERE id = '"+id+"'";
      await request.query(updateStatus)
      const currentTime = await request.query("SELECT submission_date FROM Claims WHERE id = '"+id+"'")
      const history = "INSERT INTO History VALUES('"+id+"', 'Submitted', @sd, '"+form_creator+"')"
      request.input('sd', sql.DateTime, currentTime.recordset[0].submission_date)
      await request.query(history); 

      const approver = await request.query("SELECT approver_name FROM Claims C JOIN BelongsToDepartments B ON C.form_creator = B.email JOIN Approvers A ON B.department = A.department  WHERE id = '"+id+"'")
      const approver_email = approver.recordset[0].approver_name;
      const approverDetails = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+approver_email+"'"))
      const approver_name = approverDetails.recordset[0].name
      const approver_company = approverDetails.recordset[0].company
      const creatorDetails = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+form_creator+"'"))
      const creator_name = creatorDetails.recordset[0].name
      const creator_company = creatorDetails.recordset[0].company
      
      //Send email to approver
      const filePath = './email/CreatorToApprover.html';
      const source = fs.readFileSync(filePath, 'utf-8').toString();
      const template = handlebars.compile(source);
      const approverReplacements = {
        user: approver_name,
        company: approver_company,
        header: 'Claim received',
        description: 'A new claim has been submitted and is awaiting your approval.',
        type: type,
        total_amount: total_amount,
        period: period,
        creator: form_creator
      };
      const confirmationReplacements = {
        user: creator_name,
        company: creator_company,
        header: 'Claim submitted',
        description: 'Your claim has been submitted and is awaiting approval.',
        type: type,
        total_amount: total_amount,
        period: period,
        creator: form_creator
      };
      const htmlToSend = template(approverReplacements);
      const conf = template(confirmationReplacements);

      // Define the email message
      const mailOptions = {
        from: 'eclaim@engkong.com',
        to: approver_email, 
        subject: 'New claim needs approval',
        html: htmlToSend,
        
      };

      const confirmationMail = {
        from: 'eclaim@engkong.com',
        to: form_creator, 
        subject: 'Claim submission confirmation email',
        html: conf,
      }

      // Create a transporter
      const transporter = nodemailer.createTransport({
        host: "email.engkong.com", // hostname
        tls: {
            rejectUnauthorized: false
        }, 
        auth: {
          user: 'eclaim@engkong.net',
          pass: 'eclaim12345%'
        },
      });
      
      const [approverInfo, confirmation] = await Promise.all([
        sendEmailWithRetry(transporter, mailOptions, 15000, 5),
        sendEmailWithRetry(transporter, confirmationMail, 15000, 5)
      ]);

      console.log('Email sent:', (approverInfo).response);
      console.log('Email sent:', (confirmation).response);

      transporter.close();

      res.send({message: "Claim submitted!"})
      
    } else {
      return res.json({error: "known", message: "Please check all expenses before submitting!"})
    } 
  } catch(err) {
    console.log(err)
    res.send({error: "unknown", message: err.message});
  }
})



//load claims for management tab
app.get('/management/:email/:token', authenticateUser, async (req, res) => {
  try {
  
    const { email } = req.params;

    var request = new sql.Request();
    const checkApprover = await request.query("SELECT COUNT(*) AS count FROM Approvers WHERE approver_name = '"+email+"'")
    const checkProcessor = await request.query("SELECT COUNT(*) AS count FROM Processors WHERE processor_email = '"+email+"'")
    //Approver
    
    if(checkApprover.recordset[0].count >= 1) {
      const approverClaims = await request.query("SELECT C.id, form_creator, total_amount, claimees, status, form_type, pay_period_from, pay_period_to, "
      + "period_from, period_to, cost_centre, next_recipient, country, exchange_rate, company FROM Claims C LEFT OUTER JOIN MonthlyGeneral M ON C.id = M.id LEFT OUTER JOIN TravellingGeneral T ON C.id = T.id" 
      + " WHERE (submission_date IS NOT NULL AND form_creator IN (SELECT B.email FROM BelongsToDepartments B JOIN Approvers"
      + " A ON B.department = A.department WHERE A.approver_name = '"+email+"' AND form_creator != A.approver_name) OR (approval_date IS NOT NULL AND next_recipient = '"+email+"')"
      + " OR C.id IN (SELECT id FROM History WHERE person = '"+email+"'AND status != 'Created' AND id NOT IN (select id FROM History where status = 'Deleted'))) ORDER BY submission_date DESC")
      res.send(approverClaims.recordset)

    //Processor
    } else if(checkProcessor.recordset[0].count == 1) {
     const processorClaims = await request.query("SELECT C.id, form_creator, total_amount, claimees, status, form_type, pay_period_from, pay_period_to, "
     + "period_from, period_to, cost_centre, next_recipient, country, exchange_rate, company FROM Claims C LEFT OUTER JOIN MonthlyGeneral M ON C.id = M.id LEFT OUTER JOIN TravellingGeneral T ON C.id = T.id"
      + " WHERE approval_date IS NOT NULL AND form_creator IN (SELECT email FROM Employees E JOIN Processors P ON E.company_prefix = P.company"
      + " WHERE P.processor_email = '"+email+"') ORDER BY submission_date DESC")
      res.send(processorClaims.recordset)
    } else {
      res.send([])
    }
  } catch(err) {
      console.log(err)
      res.send({message: err.message});
  }

});



//Approver approves claim
app.post('/approveClaim', async (req, res) => {
  try{
    let id = req.body.claim.id;
    let approver = req.body.user;
    let form_creator = req.body.claim.form_creator;
    let type = req.body.claim.form_type;
    let total_amount = req.body.claim.total_amount
    let period = req.body.parsedDate
    var request = new sql.Request();
    var recipient = ""
    var header = ""
    var toCreator = ""
    var description = ""
    var updateStatus = ""
    var history = ""
    var confirmationDescription = ""
    var subject = ""
    var confirmationSubject = ""
    
    //check for second Approver
    //check for levels of approval, if more than 1, send to next approver
    //keep track of which approval this is at
    const checkApproval = await request.query("SELECT department_name, levels_of_approval FROM Departments WHERE department_name != '"+form_creator+"' AND department_name IN (SELECT department FROM BelongsToDepartments WHERE email = '"+form_creator+"')")
    
    const levels = checkApproval.recordset[0].levels_of_approval
    const department = checkApproval.recordset[0].department_name
    if(levels > 1) {
      const approversList = await request.query("WITH findApprovers (department, approver_name, levels) "
      + "AS (select department, approver_name, "+levels+" from Approvers where department = '"+department+"'"
      + "union all select A.department, A.approver_name, levels - 1 from Approvers A JOIN findApprovers F ON F.approver_name = A.department "
      + "where levels > 1 ) select COUNT(*) AS count from findApprovers where department = '"+approver+"'");
      const count = approversList.recordset[0].count
      //send to processor
      if(count == 0) {
        const processor = await request.query("SELECT processor_email FROM Processors WHERE company = (SELECT company_prefix FROM Employees E JOIN Claims C ON E.email = C.form_creator WHERE C.id = '"+id+"')")
        recipient = processor.recordset[0].processor_email
        updateStatus = "UPDATE Claims SET status = 'Approved', approval_date = GETDATE() WHERE id = '"+id+"'";
        description = 'A new claim has been approved and is awaiting your processing.'
        history = "INSERT INTO History VALUES('"+id+"', 'Approved', @datetime, '"+approver+"')"
        toCreator = "Your claim has been approved and sent for processing"
        header = "Claim Approved"
        confirmationDescription = 'A claim that was approved by you has been sent for processing.'
        subject = 'New claim to process'
        confirmationSubject = 'Claim sent for processing - Confirmation Email'

      } else {
        //send to next approver
        const nextApprover = await request.query("SELECT approver_name from Approvers where department = '"+approver+"'")
        recipient = nextApprover.recordset[0].approver_name
        updateStatus = "UPDATE Claims SET status = 'Pending Next Approval', approval_date = GETDATE(), next_recipient = '"+recipient+"' WHERE id = '"+id+"'";
        description = "A new claim is awaiting your approval!"
        history = "INSERT INTO History VALUES('"+id+"', 'Pending Next Approval', @datetime, '"+approver+"')"
        confirmationDescription = 'A claim that was approved by you has been sent to the next approver.'
        toCreator = "Your claim has been sent to next approver"
        header = "Claim Sent For Next Approval"
        subject = "New claim to approve"
        confirmationSubject = 'Claim sent to next approver - Confirmation Email'
      }
    //else, send to processor
    } else {
      const processor = await request.query("SELECT processor_email FROM Processors WHERE company = (SELECT company_prefix FROM Employees E JOIN Claims C ON E.email = C.form_creator WHERE C.id = '"+id+"')")
      recipient = processor.recordset[0].processor_email
      updateStatus = "UPDATE Claims SET status = 'Approved', approval_date = GETDATE() WHERE id = '"+id+"'";
      description = 'A new claim has been approved and is awaiting your processing.'
      history = "INSERT INTO History VALUES('"+id+"', 'Approved', @datetime, '"+approver+"')"
      toCreator = "Your claim has been approved and sent for processing"
      header = "Claim Approved"
      confirmationDescription = 'A claim that was approved by you has been sent for processing.'
      subject = 'New claim to process'
      confirmationSubject = 'Claim sent for processing - Confirmation Email'
    }

    await request.query(updateStatus)
    const dateTime = await request.query("SELECT approval_date FROM Claims WHERE id = '"+id+"'")
    request.input('datetime', sql.DateTime, dateTime.recordset[0].approval_date);
    await request.query(history)
    const recipientDetails = (await request.query("SELECT E.name,  C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+recipient+"'"))
    const recipient_name = recipientDetails.recordset[0].name
    const approverDetails = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+approver+"'"))
    const approver_name = approverDetails.recordset[0].name
    const creatorDetails  = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+form_creator+"'"))
    const creator_name = creatorDetails.recordset[0].name
    //trigger sending of email to next person
    
    const filePath ='./email/ApproverToFinance.html';
    const source = fs.readFileSync(filePath, 'utf-8').toString();
    const template = handlebars.compile(source);
    const nextPerson = {
      user: recipient_name,
      company: recipientDetails.recordset[0].company,
      header: 'Claim received',
      description: description,
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      approvedBy: approver
    };
    const confirmationReplacements = {
      user: approver_name,
      company: approverDetails.recordset[0].company,
      header: 'Claim approved',
      description: confirmationDescription,
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      approvedBy: approver
    };

    const confirmationContent = {
      user: creator_name,
      company: creatorDetails.recordset[0].company_prefix,
      header: header,
      description: toCreator,
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      approvedBy: approver
    };
	  
    const htmlToSend = template(nextPerson);
    const conf = template(confirmationReplacements);
    const toFormCreator = template(confirmationContent)

    // Define the email message
    const mailOptions = {
      from: 'eclaim@engkong.com',
      to: recipient,
      subject: subject,
      html: htmlToSend,
      
    };
    
    const confirmationMail = {
      from: 'eclaim@engkong.com',
      to: approver,
      subject: confirmationSubject, 
      html: conf,
    }

    const confirmationDetails = {
      from: 'eclaim@engkong.com',
      to: form_creator,
      subject: confirmationSubject, 
      html: toFormCreator,
    }

    // Create a transporter
    const transporter = nodemailer.createTransport({
      host: "email.engkong.com", // hostname
      tls: {
          rejectUnauthorized: false
      }, 
      auth: {
        user: 'eclaim@engkong.net',
        pass: 'eclaim12345%'
      },
    });
    
    const [approverInfo, confirmation, sendToCreator] = await Promise.all([
      sendEmailWithRetry(transporter, mailOptions, 15000, 5),
      sendEmailWithRetry(transporter, confirmationMail, 15000, 5),
      sendEmailWithRetry(transporter, confirmationDetails, 15000,  5)
      
    ]);

    console.log('Email sent to recipient:', (approverInfo).response);
    console.log('Email sent back to approver:', (confirmation).response);
    console.log('Email sent to form creator:', (sendToCreator).response);

    transporter.close();

    res.send({message: "Claim approved!"})
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

});


//Processor processes claim
app.post('/processClaim', async (req, res) => {
  try{
    let id = req.body.claim.id;
    let processor = req.body.user;
    let form_creator = req.body.claim.form_creator;
    let type = req.body.claim.form_type;
    let total_amount = req.body.claim.total_amount
    let period = req.body.parsedDate
    var request = new sql.Request();
    const updateStatus = "UPDATE Claims SET status = 'Processed', processed_date = GETDATE() WHERE id = '"+id+"'";
    await request.query(updateStatus)
    const getTime = await request.query("SELECT processed_date FROM Claims WHERE id = '"+id+"'")
    const history = "INSERT INTO History VALUES('"+id+"', 'Processed', @datetime, '"+processor+"')"
    request.input('datetime', sql.DateTime, getTime.recordset[0].processed_date);
    await request.query(history)
    //trigger sending of email to form creator

    const approvers = await request.query("SELECT DISTINCT person FROM History WHERE id = '"+id+"' AND (status = 'Approved' OR status = 'Pending Next Approval')")
    var approverEmail = ''
    for (var i = 0; i < approvers.recordset.length; i++) {
      if(i == approvers.recordset.length - 1) {
        approverEmail += approvers.recordset[i].person
      } else {
        approverEmail += (approvers.recordset[i].person + ', ')
      }
    }
    const creatorDetails  = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+form_creator+"'"))
    const creator_name = creatorDetails.recordset[0].name
    const processorDetails  = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+processor+"'"))
    const processor_name = processorDetails.recordset[0].name

    const filePath = './email/FinanceToCreator.html';
    const source = fs.readFileSync(filePath, 'utf-8').toString();
    const template = handlebars.compile(source);
    const creatorReplacements = {
      user: creator_name,
      company: creatorDetails.recordset[0].company,
      header: 'Claim processed',
      description: 'Your claim has been processed!',
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      approvedBy: approverEmail,
      processedBy: processor
    };
    const confirmationReplacements = {
      user: processor_name,
      company: processorDetails.recordset[0].company,
      header: 'Claim processed',
      description: 'You have processed a claim.',
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      approvedBy: approverEmail,
      processedBy: processor
    };
    const htmlToSend = template(creatorReplacements);
    const conf = template(confirmationReplacements);

    // Define the email message
    const mailOptions = {
      from: 'eclaim@engkong.com',
      to: form_creator, 
      subject: 'Your Claim has been processed',
      html: htmlToSend,
      
    };
    
    const confirmationMail = {
      from: 'eclaim@engkong.com',
      to: processor, 
      subject: 'You have processed a claim',
      html: conf,
    }

    // Create a transporter
    const transporter = nodemailer.createTransport({
      host: "email.engkong.com", // hostname
      tls: {
          rejectUnauthorized: false
      }, 
      auth: {
        user: 'eclaim@engkong.net',
        pass: 'eclaim12345%'
      },
    });

    // Send the email
    const [approverInfo, confirmation] = await Promise.all([
      sendEmailWithRetry(transporter, mailOptions, 15000, 5),
      sendEmailWithRetry(transporter, confirmationMail, 15000, 5)
    ]);
    console.log('Email sent:', (approverInfo).response);
    console.log('Email sent:', (confirmation).response);
    transporter.close()
    res.send({message: "Claim processed!"})
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

});


//Approver rejects claim
app.post('/approverRejectClaim', async (req, res) => {
  try {
    var request = new sql.Request();
    let id = req.body.claim.id;
    let approver = req.body.user;
    let form_creator = req.body.claim.form_creator;
    let type = req.body.claim.form_type;
    let total_amount = req.body.claim.total_amount
    let period = req.body.parsedDate
    let description = req.body.description
    var recipient = ""
    var status = ""
    var emailDescription = "Your claim has been rejected"
    var subject = "Your claim has been rejected"
    
    const checkApproval = await request.query("SELECT department_name, levels_of_approval FROM Departments WHERE department_name != '"+form_creator+"' AND department_name IN (SELECT department FROM BelongsToDepartments WHERE email = '"+form_creator+"')")
    const levels = checkApproval.recordset[0].levels_of_approval
    const department = checkApproval.recordset[0].department_name
    if(levels > 1) {
      const approversList = await request.query("WITH findApprovers (department, approver_name, levels) "
      + "AS (select department, approver_name, "+levels+" from Approvers where department = '"+department+"'"
      + "union all select A.department, A.approver_name, levels - 1 from Approvers A JOIN findApprovers F ON F.approver_name = A.department "
      + "where levels > 1 ) select department from findApprovers where approver_name = '"+approver+"'");
      const previousApprover = approversList.recordset[0].department
      const creatorDepartment = await request.query("SELECT department FROM BelongsToDepartments WHERE email = '"+form_creator+"'")
      if (previousApprover == creatorDepartment.recordset[0].department) {
          recipient = form_creator
          status = "Rejected"
          const updateStatus = "UPDATE Claims SET status = '"+status+"', rejection_date = GETDATE() WHERE id = '"+id+"'";
          await request.query(updateStatus)
          const getTime = await request.query("SELECT rejection_date FROM Claims WHERE id = '"+id+"'")
          const history = "INSERT INTO History VALUES('"+id+"', 'Rejected', @datetime, '"+approver+"')"
          request.input('datetime', sql.DateTime, getTime.recordset[0].rejection_date);
          await request.query(history)
      } else {
          recipient = previousApprover
          status = "Rejecting"
          emailDescription = form_creator + "'s claim needs your rejection"
          subject = "Claim needs your rejection"
          const updateStatus = "UPDATE Claims SET status = '"+status+"', next_recipient = '"+previousApprover+"', rejection_date = GETDATE() WHERE id = '"+id+"'";
          await request.query(updateStatus)
          const getTime = await request.query("SELECT rejection_date FROM Claims WHERE id = '"+id+"'")
          const history = "INSERT INTO History VALUES('"+id+"', 'Rejected by approver', @datetime, '"+approver+"')"
          request.input('datetime', sql.DateTime, getTime.recordset[0].rejection_date);
          await request.query(history)
      }
    } else {
        recipient = form_creator
        status = "Rejected"
        const updateStatus = "UPDATE Claims SET status = '"+status+"', rejection_date = GETDATE() WHERE id = '"+id+"'";
        await request.query(updateStatus)
        const currentTime = await request.query("SELECT rejection_date FROM Claims WHERE id = '"+id+"'")
        const history = "INSERT INTO History VALUES('"+id+"', 'Rejected', @datetime, '"+approver+"')"
        request.input('datetime', sql.DateTime, currentTime.recordset[0].rejection_date);
        await request.query(history)
    }
  
    const approverDetails  = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+approver+"'"))
    const recipientDetails  = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+recipient+"'"))
    const approver_name = approverDetails.recordset[0].name
    const recipient_name = recipientDetails.recordset[0].name

    
    //trigger send email back to form creator
    const filePath = './email/Rejection.html';
    const source = fs.readFileSync(filePath, 'utf-8').toString();
    const template = handlebars.compile(source);
    const replacements = {
      user: recipient_name,
      company: recipientDetails.recordset[0].company,
      header: 'Claim rejected',
      description: emailDescription,
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      rejector: approver,
      message: description
    };
    const confirmationReplacements = {
      user: approver_name,
      company: approverDetails.recordset[0].company,
      header: 'Claim rejected',
      description: 'You have rejected a claim.',
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      rejector: approver,
      message: description
    };
    const htmlToSend = template(replacements);
    const conf = template(confirmationReplacements);

    // Define the email message
    const mailOptions = {
      from: 'eclaim@engkong.com',
      to: recipient,
      subject: subject,
      html: htmlToSend,
      
    };

    const confirmationMail = {
      from: 'eclaim@engkong.com',
      to: approver, 
      subject: 'You have rejected a claim',
      html: conf,
    }
    
    // Create a transporter
    const transporter = nodemailer.createTransport({
      host: "email.engkong.com", // hostname
      tls: {
          rejectUnauthorized: false
      }, 
      auth: {
        user: 'eclaim@engkong.net',
        pass: 'eclaim12345%'
      },
    });

    const [info, confirmation] = await Promise.all([
      sendEmailWithRetry(transporter, mailOptions, 15000, 5),
      sendEmailWithRetry(transporter, confirmationMail, 15000, 5)
    ]);

    transporter.close();

    console.log('Email sent:', info.response);
    console.log('Email sent:', confirmation.response);


    res.send({message: "Claim rejected!"})
  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

})


//Processor rejects claim
app.post('/processorRejectClaim', async (req, res) => {
  try {
    var request = new sql.Request();
    let id = req.body.claim.id;
    let processor = req.body.user;
    let form_creator = req.body.claim.form_creator;
    let type = req.body.claim.form_type;
    let total_amount = req.body.claim.total_amount
    let period = req.body.parsedDate
    let description = req.body.description
    //check previous status
    const previousApprover = await request.query("SELECT top 1 person FROM History WHERE id = '"+id+"' AND status = 'Approved' ORDER BY date DESC")
    const approver = previousApprover.recordset[0].person
    const updateStatus = "UPDATE Claims SET status = 'Rejected by processor', next_recipient = '"+approver+"', rejection_date = GETDATE() WHERE id = '"+id+"'";
    await request.query(updateStatus)
    const currentTime = await request.query("SELECT rejection_date FROM Claims WHERE id = '"+id+"'")
    const history = "INSERT INTO History VALUES('"+id+"', 'Rejected by processor', @datetime, '"+processor+"')"
    request.input('datetime', sql.DateTime, currentTime.recordset[0].rejection_date);
    await request.query(history)
    //trigger send email back to approver

    const approverDetails = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+approver+"'"))
    const approver_name = approverDetails.recordset[0].name
    const processorDetails = (await request.query("SELECT E.name, C.name AS company FROM Employees E JOIN Companies C ON E.company_prefix = C.prefix WHERE email = '"+processor+"'"))
    const processor_name = processorDetails.recordset[0].name
  
    const filePath = './email/Rejection.html';
    const source = fs.readFileSync(filePath, 'utf-8').toString();
    const template = handlebars.compile(source);
    const replacements = {
      user: approver_name,
      company: approverDetails.recordset[0].company,
      header: 'Claim rejected',
      description: 'A claim that was approved by you has been rejected.',
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      rejector: processor,
      message: description
    };
    const confirmationReplacements = {
      user: processor_name,
      company: processorDetails.recordset[0].company,
      header: 'Claim rejected',
      description: 'You have rejected a claim.',
      type: type,
      total_amount: total_amount,
      period: period,
      creator: form_creator,
      rejector: processor,
      message: description
    };
    const htmlToSend = template(replacements);
    const conf = template(confirmationReplacements);

    // Define the email message
    const mailOptions = {
      from: 'eclaim@engkong.com',
      to: approver,  
      subject: 'A claim approved by you has been rejected',
      html: htmlToSend,
      
    };

    const confirmationMail = {
      from: 'eclaim@engkong.com',
      to: processor, 
      subject: 'You have rejected a claim',
      html: conf,
    }

    // Create a transporter
    const transporter = nodemailer.createTransport({
      host: "email.engkong.com", // hostname
      tls: {
          rejectUnauthorized: false
      }, 
      auth: {
        user: 'eclaim@engkong.net',
        pass: 'eclaim12345%'
      },
    });


    const [info, confirmation] = await Promise.all([
      sendEmailWithRetry(transporter, mailOptions, 15000, 5),
      sendEmailWithRetry(transporter, confirmationMail, 15000, 5)
    ]);

    transporter.close()

    console.log('Email sent:', (info).response);
    console.log('Email sent:', (confirmation).response);

    
    res.send({message: "Claim rejected!"})

  } catch(err) {
    console.log(err)
    res.send({message: err.message});
  }

})


//gets history of claim from database
app.get('/getHistory/:id/:status/:token', expenseAuthentication, async (req, res) => {
  const { id, status} = req.params;   
  try {
    var request = new sql.Request();

    const check = await request.query("SELECT COUNT(*) AS count FROM History WHERE id = '"+id+"' AND status = 'Rejected'")
    //get all approvers so far
    if(status == 'Approved' || status == 'Pending Next Approval' || status == 'Processed') {
      //rejected before
      if(check.recordset[0].count > 0) {
          const query = "SELECT DISTINCT person FROM History WHERE id = '"+id+"' AND (status = 'Approved' OR status = 'Pending Next Approval') " +
        "AND date > (SELECT top 1 date FROM History WHERE id = '"+id+"' AND status = 'Rejected')"
          const approvers = await request.query(query)
          if(status == 'Processed') {
            const processors = await request.query("SELECT DISTINCT person FROM History WHERE id = '"+id+"' AND status = 'Processed' AND date > (SELECT top 1 date FROM History WHERE id = '"+id+"' AND status = 'Rejected')")
            res.send({approvers: approvers.recordset, processor: processors.recordset})
          } else {
            res.send({approvers: approvers.recordset, processor: []})
          }
      //never rejected before
      } else {
          const result = await request.query("SELECT DISTINCT person FROM History WHERE id = '"+id+"' AND (status = 'Approved' OR status = 'Pending Next Approval')")
          if(status == 'Processed') {
            const processors = await request.query("SELECT DISTINCT person FROM History WHERE id = '"+id+"' AND status = 'Processed'")
            res.send({approvers: result.recordset, processor: processors.recordset})
          } else {
            res.send({approvers: result.recordset, processor: []})
          }
      }
    } else {
      res.send({approvers: [], processor: []})
    }

  } catch(err) {
    console.log(err)
    res.send({message: err.message})
  }

})

//user changes password
app.post('/changePassword', async (req, res) => {
  let newPassword = req.body.newPassword;
  let user = req.body.user;
  let oldPassword = req.body.oldPassword;

  try {
    var request = new sql.Request();
    const check = await request.query("SELECT COUNT(*) AS count FROM Accounts WHERE email = '"+user+"' AND password = '"+oldPassword+"'")
    if(check.recordset[0].count == 0) {
      return res.json({error: "known", message: "You are not allowed to change this password!"})
    } else if(check.recordset[0].count = 1) {
      await request.query("UPDATE Accounts SET password = '"+newPassword+"' WHERE email = '"+user+"'")
      const token = generateAccessToken({ email: user, password: newPassword });
      res.send({message: "Success!", token: token})
    }
  } catch(err) {
    console.log(err)
    res.send({error: "unknown", message: err.message})
  }

})

//get current gst rate from database
app.get('/getGST', async (req, res) => {
  try {
    var request = new sql.Request();
    const result = await request.query("SELECT rate FROM GST")
    res.send({gst: result.recordset[0].rate})

  } catch(err) {
    console.log(err)
    res.send({message: err.message})
  }

})

//update gst rate in database
app.post('/updateGST', async (req, res) => {
  try {
    let rate = req.body.gst;
    var request = new sql.Request();
    await request.query("UPDATE GST set rate = "+rate+"")
    res.send({message: "Success!"})

  } catch(err) {
    console.log(err)
    res.send({message: err.message})
  }
})
