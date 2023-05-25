import { Animated, TextInput, StyleSheet, Text, View, Image, TouchableOpacity, FlatList, ImageBackgroundComponent} from 'react-native';
import React, { useRef, useState, useEffect } from "react";
import { MoveNegAnimation, MovePosAnimation } from '../../assets/animation/AllAnimations'; 
import { Ionicons } from "react-native-vector-icons";
import useAuth from '../../hooks/useAuth';


export default function AdminHomeScreen({ navigation }) {        
  const [data, setData] = useState("");
  

  
  useEffect(() => {

    fetch("http://localhost:5000/admin")
    .then((res) => res.json())
    .then((data) => setData(data))

  }, []);

  /*
  const DATA = [
    {
      email: 'karenlim@gmail.com',
      name: 'Karen Lim',
      approver: 'john toh',
      processor: 'ruben tan',
    },
    {
      email: 'karentan@gmail.com',
      name: 'Karen Tan',
      approver: 'john toh',
      processor: 'ruben tan',
    },
  ]; 
  */

  const AddButtonHover = useRef(new Animated.Value(0)).current;
  const [selectedId, setSelectedId] = useState();
  const [search, setSearch] = useState('')

  const styles = StyleSheet.create({
    page: {
      height: "100%",
      width: "100%",
      minWidth: "330px",
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "Arial",
    },
    pageDefault: {
      width: "100%",
      height: "90%",
      backgroundColor: '#fff',
      alignItems: 'center',
      flexDirection: "column",
      
    },
    topCard: {
      height: "130px",
      width:"100%",
      alignItems: "center",
      justifyContent: "flex-end",
      flexDirection: "column",
      borderBottomWidth: "2px",
      borderColor: "#DADADA"
    },

    bottomCard: {
      bottom: "0",
      height: "100px",
      width:"100%",
      alignItems: "center",
      justifyContent: "flex-end",
      flexDirection: "column",
      borderTopWidth: "2px",
      borderColor: "#DADADA",
      backgroundColor: "white",
    },

    text: {
      fontSize: "17px",
      fontWeight: "700",
      fontFamily: "inherit",
    },
    textInput: {
      height: "35px",
      color: "#6A6A6A",
      backgroundColor: "#D9D9D9",
      borderWidth: "1px",
      borderRadius: "12px",
      padding: "10px",
      borderColor: "#DADADA",
    },

    content: {
      width:"95%",
      flex:"1",
    },

    inputContainer: {
      paddingVertical:'5px',
      width:'85%',
      paddingBottom: "15px",
    },
    defaultButton: {
      fontFamily: "inherit",
      backgroundColor: "#E04F4F",
      border: "none",
  
      padding: "10px",
      color: "white",
      textAlign: "center",
      fontSize: "16px",
      fontWeight: "700",
      
      height: "40px",
      borderRadius: "14px",
  
      cursor: "pointer"
    },
    userCard: {
      backgroundColor: 'white',
      height:"80px",
      padding: "10px",
      borderBottomWidth: "0.5px",
      borderTopWidth: "0.5px",
      borderColor: "#DADADA",
      flexDirection: "row",
      alignItems:"center"
    },

  });

  const Item = ({name, email, approver, processor, backgroundColor, transform, onPress, onMouseEnter, onMouseLeave}) => (
    <TouchableOpacity onPress={onPress} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={[styles.userCard,{backgroundColor},{transform}]}>
      <View style={{height:"100%", width:"10%", minWidth:"70px", alignItems: "center", justifyContent: "center"}}>
      <Text><Ionicons  name="person-outline" color="#444" size="large"/></Text>
      </View>

      <View style={{height:"100%", width:"50%", justifyContent:"center"}}>
      <Text style={{fontSize: "13px", fontWeight:"700"}}>{name}</Text>
      <Text style={{color:"#444444", fontSize: "11px", marginLeft:"25px"}}>Email: {email}</Text>
      <Text style={{color:"#444444", fontSize: "11px", marginLeft:"25px"}}>Approver: {approver}</Text>
      <Text style={{color:"#444444", fontSize: "11px", marginLeft:"25px"}}>Processor: {processor}</Text>
      </View>
      
    </TouchableOpacity>
  );

  
  const renderItem = ({item}) => {

    const backgroundColor = item.email === selectedId ? '#EEEEEE' : 'white';
    const transform = item.email === selectedId ? [{translateX: 2 }] : [{translateX: 0 }];
    
    return (
      <Item 
        name={item.name} 
        email = {item.email}
        approver = {null}
        processor = {item.company_prefix == item.company ? item.processor_email : 'None'}

        onMouseEnter={() => setSelectedId(item.email)} 
        onMouseLeave={() => setSelectedId(null)}
        onPress={() => navigation.navigate("AdminEditUserScreen", { data })}
        backgroundColor={backgroundColor}
        transform={transform}
      />
    )
  }

  const { logoutUser } = useAuth();

  async function handleLogOut() {
    try {
      logoutUser();
    } catch (error) {
      console.log(error);
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.pageDefault}>
      <View style={styles.topCard}>
        <Text style={{paddingBottom:"15px"}}>Admin Home</Text>
        <Text style={{fontFamily:"inherit", fontSize: "25px", fontWeight:"700"}}>User Accounts</Text>
        <View style={styles.inputContainer}>
          <TextInput style={styles.textInput}
            placeholder="Search" 
            value={search} 
            onChangeText={(search) => setSearch(search)} 
            autoCapitalize="none" 
            autoCorrect={false} 
          />
        </View>
      </View>


      <View style={styles.content}>
      <FlatList
        style={{height:"0px"}}
        showsVerticalScrollIndicator={false}
        data={data}
        renderItem={renderItem}
        keyExtractor={item => item.id}
      />
      </View>



      <View style={styles.bottomCard}>
        <Text style={{paddingTop:"15px"}}>Total Employees:</Text>
        <Text style={{paddingBottom: "10px", fontFamily:"inherit", fontSize: "20px", fontWeight:"700"}}>{data.length}</Text>
        
        <Animated.View onMouseEnter={() => MoveNegAnimation(AddButtonHover)} onMouseLeave={() => MovePosAnimation(AddButtonHover)} style={{maxWidth: "400px", width: "90%", transform: [{translateY: AddButtonHover }]}}>
        <TouchableOpacity onPress={() => navigation.navigate("AdminAddUserScreen")}  style={styles.defaultButton} > Add </TouchableOpacity>
        <TouchableOpacity onPress={() => handleLogOut()}  style={styles.defaultButton} > Log Out </TouchableOpacity>
        </Animated.View>

      </View>


      </View>
    </View>
    
  );
}


